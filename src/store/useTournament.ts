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

export type NewPlayer = Omit<Player, 'id' | 'withdrawn'> & {
  /** Keeps an accepted registration's id, so the server can match it. */
  id?: string;
};

interface Actions {
  updateInfo: (
    patch: Partial<Pick<Tournament, 'name' | 'location' | 'arbiter' | 'startDate' | 'totalRounds' | 'byePoints' | 'tiebreaks' | 'registrationOpen'>>,
  ) => void;
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
  /** Clears rounds and results but keeps players and settings. */
  resetRounds: () => void;
  reset: () => void;
}

/**
 * local   — no server (yarn dev, offline): full editing, browser storage only.
 * viewer  — shared server, read-only: shows `shared`, never touches the persisted copy.
 * arbiter — shared server, PIN entered: edits the persisted copy, which syncs to the server.
 */
export type Mode = 'local' | 'viewer' | 'arbiter';

interface State {
  tournament: Tournament;
  mode: Mode;
  shared: Tournament | null;
}

const uid = () => crypto.randomUUID();

// Viewers can't change anything, whatever the UI shows.
const update = (set: (fn: (s: State) => Partial<State>) => void, fn: (t: Tournament) => Tournament) =>
  set((s) => (s.mode === 'viewer' ? {} : { tournament: fn(s.tournament) }));

export const useTournament = create<State & Actions>()(
  persist(
    (set, get) => ({
      tournament: emptyTournament(),
      mode: 'local',
      shared: null,

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
        if (get().mode === 'viewer') return null;
        const t = get().tournament;
        if (t.system === 'roundrobin' && t.rounds.length) return 'Le toutes rondes a commencé — impossible d\'ajouter des joueurs.';
        update(set, (t) => {
          const fresh = players.filter((p) => !p.id || !t.players.some((x) => x.id === p.id));
          const all = [...t.players, ...fresh.map((p) => ({ ...p, id: p.id ?? uid(), withdrawn: false }))];
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
        if (get().mode === 'viewer') return { error: null, warning: null };
        const t = get().tournament;
        const next = t.rounds.length + 1;
        if (next > t.totalRounds) return { error: `Les ${t.totalRounds} rondes sont déjà appariées.`, warning: null };
        if (t.rounds.length && !isRoundComplete(t, t.rounds.length)) {
          return { error: `Saisissez d'abord tous les résultats de la ronde ${t.rounds.length}.`, warning: null };
        }

        if (t.system === 'roundrobin') {
          if (t.players.length < 2) return { error: 'Il faut au moins 2 joueurs.', warning: null };
          const order = t.rrOrder.length ? t.rrOrder : startingRank(t.players).map((p) => p.id);
          const pairings = pairRoundRobin(order, next);
          update(set, (t) => ({
            ...t,
            rrOrder: order,
            registrationOpen: next === 1 ? false : t.registrationOpen,
            rounds: [...t.rounds, { number: next, pairings, halfByes: [] }],
          }));
          return { error: null, warning: null };
        }

        const halfByes = t.pendingHalfByes.filter((id) => t.players.some((p) => p.id === id && !p.withdrawn));
        const res = pairSwiss(t, next, halfByes);
        if (!res.ok) return { error: res.error, warning: null };
        update(set, (t) => ({
          ...t,
          pendingHalfByes: [],
          // Round 1 closes sign-ups; the arbiter can reopen them for late entries.
          registrationOpen: next === 1 ? false : t.registrationOpen,
          rounds: [...t.rounds, { number: next, pairings: res.pairings, halfByes }],
        }));
        const warning = res.relaxedBye
          ? 'L\'exempt a été attribué à un joueur ayant déjà gagné par forfait — aucun autre appariement n\'était possible.'
          : !res.strictColors
            ? 'Les règles de couleurs n\'ont pas toutes pu être respectées cette ronde.'
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
        if (get().mode === 'viewer') return null;
        const res = parseTournamentJson(text);
        if (!res.ok) return res.error;
        set({ tournament: res.tournament });
        return null;
      },

      resetRounds: () =>
        update(set, (t) => ({
          ...t,
          rounds: [],
          pendingHalfByes: [],
          rrOrder: [],
          players: t.players.map((p) => ({ ...p, withdrawn: false })),
        })),

      reset: () => {
        if (get().mode === 'viewer') return;
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

const EMPTY = emptyTournament();

/** The tournament on screen: the shared copy for viewers, the editable copy otherwise. */
export const useCurrentTournament = () => useTournament((s) => (s.mode === 'viewer' ? (s.shared ?? EMPTY) : s.tournament));

export const useCanEdit = () => useTournament((s) => s.mode !== 'viewer');
