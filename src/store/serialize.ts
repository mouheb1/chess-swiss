import { DEFAULT_TIEBREAKS, type Tournament } from '../engine/types';

export function emptyTournament(): Tournament {
  return {
    name: 'New tournament',
    location: '',
    arbiter: '',
    startDate: new Date().toISOString().slice(0, 10),
    system: 'swiss',
    totalRounds: 5,
    byePoints: 1,
    tiebreaks: [...DEFAULT_TIEBREAKS.swiss],
    players: [],
    rounds: [],
    pendingHalfByes: [],
    rrOrder: [],
  };
}

export function exportJson(t: Tournament): string {
  return JSON.stringify({ app: 'swiss-lite', version: 1, tournament: t }, null, 2);
}

/** Parses an exported file (or a bare tournament object). Fills defaults for fields older files may lack. */
export function parseTournamentJson(text: string): { ok: true; tournament: Tournament } | { ok: false; error: string } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'File is not valid JSON.' };
  }
  const t = (data as { tournament?: unknown })?.tournament ?? data;
  if (!isTournament(t)) return { ok: false, error: 'File does not look like a Swiss Lite tournament.' };
  return {
    ok: true,
    tournament: {
      ...emptyTournament(),
      ...t,
      players: t.players.map((p) => ({ ...p, withdrawn: !!p.withdrawn })),
      rounds: t.rounds.map((r) => ({ ...r, halfByes: r.halfByes ?? [] })),
    },
  };
}

function isTournament(x: unknown): x is Tournament {
  if (!x || typeof x !== 'object') return false;
  const t = x as Record<string, unknown>;
  return (
    typeof t.name === 'string' &&
    (t.system === 'swiss' || t.system === 'roundrobin') &&
    typeof t.totalRounds === 'number' &&
    Array.isArray(t.players) &&
    t.players.every((p) => p && typeof p.id === 'string' && typeof p.name === 'string' && typeof p.rating === 'number') &&
    Array.isArray(t.rounds) &&
    t.rounds.every((r) => r && typeof r.number === 'number' && Array.isArray(r.pairings))
  );
}
