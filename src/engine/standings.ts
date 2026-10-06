import { startingRank, summarize, type PlayerSummary } from './scores';
import { aro, buchholz, buchholzCut1, directEncounter, sonnebornBerger, wins } from './tiebreaks';
import type { Player, TiebreakId, Tournament } from './types';

export interface StandingRow {
  rank: number;
  player: Player;
  startRank: number;
  points: number;
  tiebreaks: Partial<Record<TiebreakId, number>>;
  summary: PlayerSummary;
}

/** Standings after `uptoRound`, sorted by points then the tournament's tiebreak order. */
export function computeStandings(t: Tournament, uptoRound: number): StandingRow[] {
  const all = summarize(t, uptoRound);
  const byId = new Map(t.players.map((p) => [p.id, p]));
  const startRanks = new Map(startingRank(t.players).map((p, i) => [p.id, i + 1]));

  const rows: StandingRow[] = t.players.map((p) => {
    const s = all.get(p.id)!;
    const tb: Partial<Record<TiebreakId, number>> = {};
    for (const id of t.tiebreaks) {
      if (id === 'buchholz') tb[id] = buchholz(s, all);
      else if (id === 'buchholzCut1') tb[id] = buchholzCut1(s, all);
      else if (id === 'sonnebornBerger') tb[id] = sonnebornBerger(s, all);
      else if (id === 'wins') tb[id] = wins(s);
      else if (id === 'aro') tb[id] = aro(s, byId);
    }
    return { rank: 0, player: p, startRank: startRanks.get(p.id)!, points: s.points, tiebreaks: tb, summary: s };
  });

  // Sort key by key; direct encounter is resolved inside each group still tied at that point.
  let groups: StandingRow[][] = [[...rows].sort((a, b) => b.points - a.points)];
  groups = splitBy(groups, (r) => r.points);
  for (const id of t.tiebreaks) {
    if (id === 'directEncounter') {
      for (const g of groups) {
        const de = directEncounter(g.map((r) => r.summary));
        for (const r of g) r.tiebreaks.directEncounter = de.get(r.player.id) ?? 0;
      }
    }
    groups = groups.map((g) => [...g].sort((a, b) => (b.tiebreaks[id] ?? 0) - (a.tiebreaks[id] ?? 0)));
    groups = splitBy(groups, (r) => r.tiebreaks[id] ?? 0);
  }

  const out: StandingRow[] = [];
  for (const g of groups) {
    const rank = out.length + 1;
    for (const r of [...g].sort((a, b) => a.startRank - b.startRank)) out.push({ ...r, rank });
  }
  return out;
}

function splitBy(groups: StandingRow[][], key: (r: StandingRow) => number): StandingRow[][] {
  const out: StandingRow[][] = [];
  for (const g of groups) {
    let cur: StandingRow[] = [];
    for (const r of g) {
      if (cur.length && key(cur[0]) !== key(r)) {
        out.push(cur);
        cur = [];
      }
      cur.push(r);
    }
    if (cur.length) out.push(cur);
  }
  return out;
}
