import type { PlayerSummary } from './scores';
import type { Player } from './types';

/**
 * Buchholz contributions per round: opponent's score for games played over the board,
 * the player's own score for unplayed rounds (bye, forfeit, half-bye, absent) — simplified virtual opponent.
 */
function buchholzParts(s: PlayerSummary, all: Map<string, PlayerSummary>): number[] {
  return s.records.map((r) =>
    r.kind === 'game' && r.opponent ? (all.get(r.opponent)?.points ?? 0) : s.points,
  );
}

export function buchholz(s: PlayerSummary, all: Map<string, PlayerSummary>): number {
  return buchholzParts(s, all).reduce((a, b) => a + b, 0);
}

export function buchholzCut1(s: PlayerSummary, all: Map<string, PlayerSummary>): number {
  const parts = buchholzParts(s, all);
  if (parts.length === 0) return 0;
  return parts.reduce((a, b) => a + b, 0) - Math.min(...parts);
}

export function sonnebornBerger(s: PlayerSummary, all: Map<string, PlayerSummary>): number {
  return s.records.reduce((sum, r) => {
    if (r.kind !== 'game' || !r.opponent || r.outcome === null) return sum;
    return sum + r.outcome * (all.get(r.opponent)?.points ?? 0);
  }, 0);
}

export function wins(s: PlayerSummary): number {
  return s.records.filter((r) => r.kind === 'game' && r.outcome === 1).length;
}

export function aro(s: PlayerSummary, players: Map<string, Player>): number {
  const ratings = s.records
    .filter((r) => r.kind === 'game' && r.opponent)
    .map((r) => players.get(r.opponent!)?.rating ?? 0);
  if (ratings.length === 0) return 0;
  return Math.round(ratings.reduce((a, b) => a + b, 0) / ratings.length);
}

/**
 * Direct encounter within a tied group: points scored against the other group members,
 * only when every pair in the group has played. Otherwise 0 for everyone.
 */
export function directEncounter(group: PlayerSummary[]): Map<string, number> {
  const ids = new Set(group.map((s) => s.id));
  const out = new Map<string, number>(group.map((s) => [s.id, 0]));
  if (group.length < 2) return out;
  for (const s of group) {
    const met = new Set(s.records.filter((r) => r.kind === 'game' && r.opponent && ids.has(r.opponent)).map((r) => r.opponent));
    if (met.size !== group.length - 1) return new Map(group.map((g) => [g.id, 0]));
  }
  for (const s of group) {
    const pts = s.records
      .filter((r) => r.kind === 'game' && r.opponent && ids.has(r.opponent))
      .reduce((a, r) => a + (r.outcome ?? 0), 0);
    out.set(s.id, pts);
  }
  return out;
}
