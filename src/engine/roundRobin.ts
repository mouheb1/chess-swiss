import type { Pairing } from './types';

export function rrTotalRounds(playerCount: number): number {
  if (playerCount < 2) return 1;
  return playerCount % 2 === 0 ? playerCount - 1 : playerCount;
}

/**
 * Berger table for one round. Returns [whiteIndex, blackIndex] pairs over seats 0..n-1
 * (n even). The last seat is fixed; the others rotate.
 */
export function bergerRound(n: number, round: number): [number, number][] {
  const m = n - 1;
  const k = round - 1;
  const pairs: [number, number][] = [];
  const pivot = k % m;
  // Fixed seat alternates colors every round.
  pairs.push(k % 2 === 0 ? [pivot, m] : [m, pivot]);
  for (let i = 1; i < n / 2; i++) {
    const a = (k + i) % m;
    const b = (k - i + m) % m;
    pairs.push(i % 2 === 1 ? [b, a] : [a, b]);
  }
  return pairs;
}

/** Pairings for a round-robin round. `order` is the fixed seating; odd fields get a bye seat. */
export function pairRoundRobin(order: string[], round: number): Pairing[] {
  const seats: (string | null)[] = order.length % 2 === 0 ? [...order] : [...order, null];
  const games: Pairing[] = [];
  let bye: string | null = null;
  for (const [w, b] of bergerRound(seats.length, round)) {
    const white = seats[w];
    const black = seats[b];
    if (white === null) bye = black;
    else if (black === null) bye = white;
    else games.push({ board: 0, white, black, result: null });
  }
  const pairings = games.map((g, i) => ({ ...g, board: i + 1 }));
  if (bye) pairings.push({ board: pairings.length + 1, white: bye, black: null, result: null });
  return pairings;
}
