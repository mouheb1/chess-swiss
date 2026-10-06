import { startingRank, summarize, type Color } from './scores';
import type { Pairing, Tournament } from './types';

/**
 * Simplified Dutch Swiss pairing.
 *
 * Branch and bound over the whole field (sorted by score, then starting rank) for the
 * pairing with the smallest squared score differences. Candidates are tried in Dutch
 * order (S2 counterpart, rest of the score group, then lower groups), so ties keep it. Hard constraints: no rematch, at most one pairing bye,
 * no bye after a forfeit win. A first pass also treats absolute color limits as hard;
 * if that fails, a second pass relaxes them, and a last resort allows a forfeit winner the bye.
 */

export type PairingOutcome =
  | { ok: true; pairings: Pairing[]; strictColors: boolean; relaxedBye: boolean }
  | { ok: false; error: string };

interface Entrant {
  id: string;
  rank: number;
  score: number;
  opponents: Set<string>;
  colorDiff: number; // whites - blacks over played games
  colors: Color[]; // played-game colors in order
  hadBye: boolean;
  hadForfeitWin: boolean;
}

const NODE_LIMIT = 200_000;
const TOTAL_NODE_LIMIT = 1_000_000;

class SearchAborted extends Error {}

function buildEntrants(t: Tournament, roundNumber: number, exclude: Set<string>): Entrant[] {
  const summary = summarize(t, roundNumber - 1);
  const ranks = new Map(startingRank(t.players).map((p, i) => [p.id, i + 1]));
  return t.players
    .filter((p) => !p.withdrawn && !exclude.has(p.id))
    .map((p) => {
      const s = summary.get(p.id)!;
      const colors: Color[] = [];
      const opponents = new Set<string>();
      let hadBye = false;
      let hadForfeitWin = false;
      for (const r of s.records) {
        if (r.opponent) opponents.add(r.opponent);
        if (r.kind === 'game' && r.color) colors.push(r.color);
        if (r.kind === 'bye') hadBye = true;
        if (r.kind === 'forfeit' && r.points === 1) hadForfeitWin = true;
      }
      const colorDiff = colors.reduce((d, c) => d + (c === 'W' ? 1 : -1), 0);
      return { id: p.id, rank: ranks.get(p.id)!, score: s.points, opponents, colorDiff, colors, hadBye, hadForfeitWin };
    })
    .sort((a, b) => b.score - a.score || a.rank - b.rank);
}

/** Would giving this color break the absolute limits (|diff| > 2 or three in a row)? */
function colorBreaksLimits(e: Entrant, c: Color): boolean {
  const diff = e.colorDiff + (c === 'W' ? 1 : -1);
  if (Math.abs(diff) > 2) return true;
  const n = e.colors.length;
  return n >= 2 && e.colors[n - 1] === c && e.colors[n - 2] === c;
}

/** Preferred color and how strongly (0 none, 1 mild alternate, 2 balance, 3 absolute). */
function preference(e: Entrant): { color: Color | null; strength: number } {
  if (colorBreaksLimits(e, 'W')) return { color: 'B', strength: 3 };
  if (colorBreaksLimits(e, 'B')) return { color: 'W', strength: 3 };
  if (e.colorDiff < 0) return { color: 'W', strength: 2 };
  if (e.colorDiff > 0) return { color: 'B', strength: 2 };
  const last = e.colors[e.colors.length - 1];
  if (last) return { color: last === 'W' ? 'B' : 'W', strength: 1 };
  return { color: null, strength: 0 };
}

const higher = (a: Entrant, b: Entrant) => a.score > b.score || (a.score === b.score && a.rank < b.rank);

/** Returns [white, black]. `board` (1-based) breaks ties when neither player has a preference. */
function allocateColors(a: Entrant, b: Entrant, board: number): [Entrant, Entrant] {
  const pa = preference(a);
  const pb = preference(b);
  if (pa.color && pb.color && pa.color !== pb.color) return pa.color === 'W' ? [a, b] : [b, a];
  if (pa.color && !pb.color) return pa.color === 'W' ? [a, b] : [b, a];
  if (pb.color && !pa.color) return pb.color === 'W' ? [b, a] : [a, b];
  if (pa.color && pb.color) {
    // Same preference: stronger need wins, then higher-ranked player.
    const aWins = pa.strength !== pb.strength ? pa.strength > pb.strength : higher(a, b);
    const winner = aWins ? a : b;
    const loser = aWins ? b : a;
    return pa.color === 'W' ? [winner, loser] : [loser, winner];
  }
  // No preferences at all (typically round 1): higher-ranked player gets White on odd boards.
  const [top, bottom] = higher(a, b) ? [a, b] : [b, a];
  return board % 2 === 1 ? [top, bottom] : [bottom, top];
}

function colorsOk(white: Entrant, black: Entrant): boolean {
  return !colorBreaksLimits(white, 'W') && !colorBreaksLimits(black, 'B');
}

function compatible(a: Entrant, b: Entrant, strict: boolean): boolean {
  if (a.opponents.has(b.id)) return false;
  if (!strict) return true;
  // Board only matters without preferences, where limits can't be broken anyway.
  const [w, bl] = allocateColors(a, b, 1);
  return colorsOk(w, bl) || colorsOk(bl, w);
}

/** Opponent order for the top player: its S2 counterpart, rest of S2, rest of S1 (reversed), then lower groups. */
function candidateOrder(rest: Entrant[], top: Entrant): Entrant[] {
  const group = rest.filter((e) => e.score === top.score);
  const lower = rest.filter((e) => e.score !== top.score);
  const size = group.length + 1;
  const half = Math.floor(size / 2);
  // In [top, ...group], index `half` is the S2 counterpart → group index half-1.
  const s2 = group.slice(half - 1);
  const s1 = group.slice(0, Math.max(half - 1, 0)).reverse();
  return [...s2, ...s1, ...lower];
}

interface Budget {
  nodes: number;
  limit: number;
}

/**
 * Best pairing of the pool: the one with the smallest sum of squared score differences.
 * Branch and bound over the Dutch candidate order, so the first solution found is the old
 * greedy one and ties keep Dutch order. Pruned with a per-player lower bound; when the
 * budget runs out the best pairing found so far is used.
 */
function search(pool: Entrant[], strict: boolean, budget: Budget): [Entrant, Entrant][] | null {
  const index = new Map(pool.map((e, i) => [e, i]));
  // cost[i][j]: squared score gap, or Infinity when the two can't meet.
  const cost = pool.map((a) => pool.map((b) => (a !== b && compatible(a, b, strict) ? (a.score - b.score) ** 2 : Infinity)));

  /** Each player still has to meet someone in the pool: half the sum of their cheapest options. */
  const lowerBound = (rest: Entrant[]) => {
    let lb = 0;
    for (const a of rest) {
      const row = cost[index.get(a)!];
      let min = Infinity;
      for (const b of rest) min = Math.min(min, row[index.get(b)!]);
      if (min === Infinity) return Infinity;
      lb += min;
    }
    return lb / 2;
  };

  let best: [Entrant, Entrant][] | null = null;
  let bestCost = Infinity;
  const current: [Entrant, Entrant][] = [];

  const walk = (rest: Entrant[], acc: number) => {
    if (rest.length === 0) {
      best = [...current];
      bestCost = acc;
      return;
    }
    if (++budget.nodes > budget.limit) throw new SearchAborted();
    if (acc + lowerBound(rest) >= bestCost) return;
    const [top, ...others] = rest;
    const row = cost[index.get(top)!];
    for (const opp of candidateOrder(others, top)) {
      const c = row[index.get(opp)!];
      if (c === Infinity || acc + c >= bestCost) continue;
      current.push([top, opp]);
      walk(
        others.filter((e) => e !== opp),
        acc + c,
      );
      current.pop();
    }
  };

  try {
    walk(pool, 0);
  } catch (e) {
    // Out of budget: keep the best pairing found so far, if any.
    if (!(e instanceof SearchAborted)) throw e;
  }
  return best;
}

function attempt(entrants: Entrant[], strict: boolean, strictBye: boolean) {
  if (entrants.length % 2 === 0) {
    const pairs = search(entrants, strict, { nodes: 0, limit: NODE_LIMIT });
    return pairs ? { pairs, bye: null as Entrant | null } : null;
  }
  // Bye candidates: lowest score first, then lowest-ranked. Each gets its own budget,
  // with a shared overall cap so an impossible round still fails fast.
  const byeCandidates = entrants
    .filter((e) => !e.hadBye && (!strictBye || !e.hadForfeitWin))
    .sort((a, b) => a.score - b.score || b.rank - a.rank);
  let spent = 0;
  for (const bye of byeCandidates) {
    const remaining = TOTAL_NODE_LIMIT - spent;
    if (remaining <= 0) break;
    const budget = { nodes: 0, limit: Math.min(NODE_LIMIT, remaining) };
    const pairs = search(
      entrants.filter((e) => e !== bye),
      strict,
      budget,
    );
    spent += budget.nodes;
    if (pairs) return { pairs, bye };
  }
  return null;
}

export function pairSwiss(t: Tournament, roundNumber: number, halfByes: string[]): PairingOutcome {
  const entrants = buildEntrants(t, roundNumber, new Set(halfByes));
  if (entrants.length < 2) return { ok: false, error: 'Il faut au moins 2 joueurs actifs pour apparier une ronde.' };

  // Passes from strictest to most relaxed; the last one lets a forfeit winner take the bye.
  const passes = [
    { strict: true, strictBye: true },
    { strict: false, strictBye: true },
    { strict: false, strictBye: false },
  ];
  for (const { strict, strictBye } of passes) {
    const found = attempt(entrants, strict, strictBye);
    if (!found) continue;

    // Board order first, then colors, so round-1 colors alternate down the boards.
    // Top tables: higher score in the pair, then higher combined score, then best-ranked player.
    const ordered = [...found.pairs].sort(
      ([a1, b1], [a2, b2]) =>
        Math.max(a2.score, b2.score) - Math.max(a1.score, b1.score) ||
        a2.score + b2.score - (a1.score + b1.score) ||
        Math.min(a1.rank, b1.rank) - Math.min(a2.rank, b2.rank),
    );
    const pairings: Pairing[] = ordered.map(([a, b], i) => {
      let [w, bl] = allocateColors(a, b, i + 1);
      if (strict && !colorsOk(w, bl)) [w, bl] = [bl, w];
      return { board: i + 1, white: w.id, black: bl.id, result: null };
    });
    if (found.bye) pairings.push({ board: pairings.length + 1, white: found.bye.id, black: null, result: null });
    return { ok: true, pairings, strictColors: strict, relaxedBye: !strictBye };
  }

  return {
    ok: false,
    error: 'Aucun appariement valide (chaque option répète une partie ou enfreint la règle de l\'exempt). Réduisez le nombre de rondes ou vérifiez les retraits.',
  };
}
