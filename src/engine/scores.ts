import type { Player, Result, Tournament } from './types';

export type Color = 'W' | 'B';

/** What happened to a player in one round. */
export type RecordKind = 'game' | 'forfeit' | 'bye' | 'halfbye' | 'absent' | 'pending';

export interface RoundRecord {
  round: number;
  kind: RecordKind;
  opponent: string | null;
  color: Color | null;
  points: number;
  /** 1 win, 0.5 draw, 0 loss — only for kind 'game'. */
  outcome: number | null;
}

export interface PlayerSummary {
  id: string;
  points: number;
  records: RoundRecord[];
}

const WHITE_POINTS: Record<Exclude<Result, null>, number> = {
  '1-0': 1,
  '0-1': 0,
  '½-½': 0.5,
  '+/-': 1,
  '-/+': 0,
  '0-0': 0,
};

const isForfeit = (r: Result) => r === '+/-' || r === '-/+' || r === '0-0';

export function byeValue(t: Tournament): number {
  return t.system === 'roundrobin' ? 0 : t.byePoints;
}

export function startingRank(players: Player[]): Player[] {
  return [...players].sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name));
}

/**
 * Per-player round-by-round records for rounds 1..uptoRound.
 * Every player gets exactly one record per round; players missing from a round are 'absent'.
 */
export function summarize(t: Tournament, uptoRound: number): Map<string, PlayerSummary> {
  const map = new Map<string, PlayerSummary>();
  for (const p of t.players) map.set(p.id, { id: p.id, points: 0, records: [] });

  const rounds = t.rounds.filter((r) => r.number <= uptoRound);
  for (const round of rounds) {
    const seen = new Set<string>();
    const push = (id: string, rec: Omit<RoundRecord, 'round'>) => {
      const s = map.get(id);
      if (!s) return;
      seen.add(id);
      s.records.push({ round: round.number, ...rec });
      s.points += rec.points;
    };

    for (const pr of round.pairings) {
      if (pr.black === null) {
        push(pr.white, { kind: 'bye', opponent: null, color: null, points: byeValue(t), outcome: null });
        continue;
      }
      if (pr.result === null) {
        push(pr.white, { kind: 'pending', opponent: pr.black, color: 'W', points: 0, outcome: null });
        push(pr.black, { kind: 'pending', opponent: pr.white, color: 'B', points: 0, outcome: null });
        continue;
      }
      const w = WHITE_POINTS[pr.result];
      const b = pr.result === '0-0' ? 0 : 1 - w;
      const kind: RecordKind = isForfeit(pr.result) ? 'forfeit' : 'game';
      push(pr.white, { kind, opponent: pr.black, color: 'W', points: w, outcome: kind === 'game' ? w : null });
      push(pr.black, { kind, opponent: pr.white, color: 'B', points: b, outcome: kind === 'game' ? b : null });
    }
    for (const id of round.halfByes) {
      if (!seen.has(id)) push(id, { kind: 'halfbye', opponent: null, color: null, points: 0.5, outcome: null });
    }
    for (const s of map.values()) {
      if (!seen.has(s.id)) {
        s.records.push({ round: round.number, kind: 'absent', opponent: null, color: null, points: 0, outcome: null });
      }
    }
  }
  return map;
}

export function isRoundComplete(t: Tournament, roundNumber: number): boolean {
  const r = t.rounds.find((x) => x.number === roundNumber);
  return !!r && r.pairings.every((p) => p.black === null || p.result !== null);
}
