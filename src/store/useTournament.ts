import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { pairRoundRobin, rrTotalRounds } from '../engine/roundRobin';
import { isRoundComplete, startingRank } from '../engine/scores';
import { pairSwiss } from '../engine/swiss';
import { DEFAULT_TIEBREAKS, type Player, type Result, type System, type Tournament } from '../engine/types';
import { emptyTournament, parseTournamentJson } from './serialize';

export { emptyTournament, exportJson } from './serialize';

export const STORAGE_KEY = 'swiss-lite';

/** Flips to true if the browser refuses to save (quota, private mode). */
export const useStorageStatus = create<{ failed: boolean }>(() => ({ failed: false }));

const safeStorage: Storage = {
  get length() {
    return localStorage.length;
  },
  key: (i) => localStorage.key(i),
  clear: () => localStorage.clear(),
  getItem: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      useStorageStatus.setState({ failed: true });
      return null;
    }
  },
  setItem: (k, v) => {
    try {
      localStorage.setItem(k, v);
      if (useStorageStatus.getState().failed) useStorageStatus.setState({ failed: false });
    } catch {
      useStorageStatus.setState({ failed: true });
    }
  },
  removeItem: (k) => {
    try {
      localStorage.removeItem(k);
    } catch {
      useStorageStatus.setState({ failed: true });
    }
  },
};

export type NewPlayer = Omit<Player, 'id' | 'withdrawn'>;

interface Actions {
  updateInfo: (patch: Partial<Pick<Tournament, 'name' | 'location' | 'arbiter' | 'startDate' | 'totalRounds' | 'byePoints' | 'tiebreaks'>>) => void;
  setSystem: (system: System) => void;
  addPlayers: (players: NewPlayer[]) => string | null;
  updatePlayer: (id: string, patch: Partial<NewPlayer>) => void;
  removePlayer: (id: string) => void;
  toggleWithdrawn: (id: string) => void;
  toggleHalfBye: (id: string) => void;
  pairNextRound: () => { error: string | null; warning: string | null };
  setResult: (round: number, board: number, result: Result) => void;
  swapColors: (round: number, board: number) => void;
  deleteLastRound: () => void;
  importJson: (text: string) => string | null;
  reset: () => void;
}

interface State {
  tournament: Tournament;
}

const uid = () => crypto.randomUUID();

const update = (set: (fn: (s: State) => Partial<State>) => void, fn: (t: Tournament) => Tournament) =>
  set((s) => ({ tournament: fn(s.tournament) }));

export const useTournament = create<State & Actions>()(
  persist(
    (set, get) => ({
      tournament: emptyTournament(),

      updateInfo: (patch) => update(set, (t) => ({ ...t, ...patch })),

      setSystem: (system) =>
        update(set, (t) => {
          if (t.rounds.length) return t;
          return {
            ...t,
            system,
            tiebreaks: [...DEFAULT_TIEBREAKS[system]],
            totalRounds: system === 'roundrobin' ? rrTotalRounds(t.players.length) : t.totalRounds,
            pendingHalfByes: [],
          };
        }),

      addPlayers: (players) => {
        const t = get().tournament;
        if (t.system === 'roundrobin' && t.rounds.length) return 'Round robin already started — players cannot be added.';
        update(set, (t) => {
          const all = [...t.players, ...players.map((p) => ({ ...p, id: uid(), withdrawn: false }))];
          return { ...t, players: all, totalRounds: t.system === 'roundrobin' ? rrTotalRounds(all.length) : t.totalRounds };
        });
        return null;
      },

      updatePlayer: (id, patch) =>
        update(set, (t) => ({ ...t, players: t.players.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),

      removePlayer: (id) =>
        update(set, (t) => {
          if (t.rounds.length) return t;
          const players = t.players.filter((p) => p.id !== id);
          return { ...t, players, totalRounds: t.system === 'roundrobin' ? rrTotalRounds(players.length) : t.totalRounds };
        }),

      toggleWithdrawn: (id) =>
        update(set, (t) => ({ ...t, players: t.players.map((p) => (p.id === id ? { ...p, withdrawn: !p.withdrawn } : p)) })),

      toggleHalfBye: (id) =>
        update(set, (t) => ({
          ...t,
          pendingHalfByes: t.pendingHalfByes.includes(id) ? t.pendingHalfByes.filter((x) => x !== id) : [...t.pendingHalfByes, id],
        })),

      pairNextRound: () => {
        const t = get().tournament;
        const next = t.rounds.length + 1;
        if (next > t.totalRounds) return { error: `All ${t.totalRounds} rounds are already paired.`, warning: null };
        if (t.rounds.length && !isRoundComplete(t, t.rounds.length)) {
          return { error: `Enter all results of round ${t.rounds.length} first.`, warning: null };
        }

        if (t.system === 'roundrobin') {
          if (t.players.length < 2) return { error: 'Need at least 2 players.', warning: null };
          const order = t.rrOrder.length ? t.rrOrder : startingRank(t.players).map((p) => p.id);
          const pairings = pairRoundRobin(order, next);
          update(set, (t) => ({ ...t, rrOrder: order, rounds: [...t.rounds, { number: next, pairings, halfByes: [] }] }));
          return { error: null, warning: null };
        }

        const halfByes = t.pendingHalfByes.filter((id) => t.players.some((p) => p.id === id && !p.withdrawn));
        const res = pairSwiss(t, next, halfByes);
        if (!res.ok) return { error: res.error, warning: null };
        update(set, (t) => ({ ...t, pendingHalfByes: [], rounds: [...t.rounds, { number: next, pairings: res.pairings, halfByes }] }));
        const warning = res.relaxedBye
          ? 'The bye went to a player who already had a forfeit win — no other pairing was possible.'
          : !res.strictColors
            ? 'Color limits could not all be respected this round.'
            : null;
        return { error: null, warning };
      },

      setResult: (round, board, result) =>
        update(set, (t) => ({
          ...t,
          rounds: t.rounds.map((r) =>
            r.number !== round ? r : { ...r, pairings: r.pairings.map((p) => (p.board === board ? { ...p, result } : p)) },
          ),
        })),

      swapColors: (round, board) =>
        update(set, (t) => ({
          ...t,
          rounds: t.rounds.map((r) =>
            r.number !== round
              ? r
              : {
                  ...r,
                  pairings: r.pairings.map((p) =>
                    p.board === board && p.black && p.result === null ? { ...p, white: p.black, black: p.white } : p,
                  ),
                },
          ),
        })),

      deleteLastRound: () =>
        update(set, (t) => {
          const rounds = t.rounds.slice(0, -1);
          return { ...t, rounds, rrOrder: rounds.length ? t.rrOrder : [] };
        }),

      importJson: (text) => {
        const res = parseTournamentJson(text);
        if (!res.ok) return res.error;
        set({ tournament: res.tournament });
        return null;
      },

      reset: () => {
        useTournament.persist.clearStorage();
        set({ tournament: emptyTournament() });
      },
    }),
    {
      name: STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ tournament: s.tournament }),
      migrate: (persisted) => persisted as State,
    },
  ),
);
