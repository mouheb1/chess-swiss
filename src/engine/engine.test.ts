import { describe, expect, it } from 'vitest';
import { bergerRound, pairRoundRobin, rrTotalRounds } from './roundRobin';
import { summarize } from './scores';
import { computeStandings } from './standings';
import { pairSwiss } from './swiss';
import type { Player, Result, Tournament } from './types';

function makeTournament(n: number, system: Tournament['system'] = 'swiss'): Tournament {
  const players: Player[] = Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Player ${String(i + 1).padStart(2, '0')}`,
    rating: 2000 - i * 10,
    withdrawn: false,
  }));
  return {
    name: 'T',
    location: '',
    arbiter: '',
    startDate: '',
    system,
    totalRounds: 7,
    byePoints: 1,
    tiebreaks: ['buchholzCut1', 'buchholz', 'sonnebornBerger', 'wins'],
    players,
    rounds: [],
    pendingHalfByes: [],
    rrOrder: [],
  };
}

// Deterministic PRNG so failures are reproducible.
function rng(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

const RESULTS: Result[] = ['1-0', '0-1', '½-½', '1-0', '0-1', '+/-'];

/** Independent brute force: can the active field be paired with no rematch and no second bye? */
function pairingExists(t: Tournament, round: number): boolean {
  const s = summarize(t, round - 1);
  const ids = t.players.map((p) => p.id);
  const met = (a: string, b: string) => s.get(a)!.records.some((r) => r.opponent === b);
  const hadBye = (a: string) => s.get(a)!.records.some((r) => r.kind === 'bye');
  const go = (pool: string[], byeUsed: boolean): boolean => {
    if (pool.length === 0) return true;
    const [a, ...rest] = pool;
    if (!byeUsed && pool.length % 2 === 1 && !hadBye(a) && go(rest, true)) return true;
    return rest.some((b) => !met(a, b) && go(rest.filter((x) => x !== b), byeUsed));
  };
  return go(ids, ids.length % 2 === 0);
}

// SEEDS=30 yarn test runs a wider sweep.
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const SEEDS = Number(env.SEEDS ?? 1);

describe('swiss pairing — simulation', () => {
  for (let n = 4; n <= 30; n++) {
    for (let seed = 1; seed <= SEEDS; seed++) it(`${n} players (seed ${seed})`, () => {
      const rand = rng(n * 7919 + seed * 104729);
      const t = makeTournament(n);
      const rounds = Math.min(n - 1, 7);
      for (let r = 1; r <= rounds; r++) {
        const res = pairSwiss(t, r, []);
        if (!res.ok) {
          // Only acceptable when no pairing exists at all (small fields near round-robin length).
          expect(pairingExists(t, r), `round ${r}: ${res.error}`).toBe(false);
          return;
        }

        const seen = new Map<string, number>();
        for (const p of res.pairings) {
          seen.set(p.white, (seen.get(p.white) ?? 0) + 1);
          if (p.black) seen.set(p.black, (seen.get(p.black) ?? 0) + 1);
        }
        expect(seen.size).toBe(n);
        expect([...seen.values()].every((c) => c === 1)).toBe(true);

        const before = summarize(t, r - 1);

        // Top tables first: higher score in the pair, then higher combined score.
        const keys = res.pairings
          .filter((p) => p.black)
          .map((p) => {
            const a = before.get(p.white)!.points;
            const b = before.get(p.black!)!.points;
            return [Math.max(a, b), a + b];
          });
        for (let i = 1; i < keys.length; i++) {
          const ok = keys[i][0] < keys[i - 1][0] || (keys[i][0] === keys[i - 1][0] && keys[i][1] <= keys[i - 1][1]);
          expect(ok, `round ${r} table ${i + 1} order`).toBe(true);
        }

        for (const p of res.pairings) {
          const recs = before.get(p.white)!.records;
          if (p.black) {
            expect(recs.some((x) => x.opponent === p.black)).toBe(false);
          } else {
            expect(recs.some((x) => x.kind === 'bye')).toBe(false);
            if (!res.relaxedBye) expect(recs.some((x) => x.kind === 'forfeit' && x.points === 1)).toBe(false);
          }
        }

        t.rounds.push({
          number: r,
          halfByes: [],
          pairings: res.pairings.map((p) => ({
            ...p,
            result: p.black ? RESULTS[Math.floor(rand() * RESULTS.length)] : null,
          })),
        });

        if (res.strictColors) {
          const after = summarize(t, r);
          for (const s of after.values()) {
            const cols = s.records.filter((x) => x.kind === 'game').map((x) => x.color);
            const diff = cols.reduce((d, c) => d + (c === 'W' ? 1 : -1), 0);
            expect(Math.abs(diff)).toBeLessThanOrEqual(2);
            for (let i = 2; i < cols.length; i++) {
              expect(cols[i] === cols[i - 1] && cols[i] === cols[i - 2]).toBe(false);
            }
          }
        }
      }
    });
  }

  it('reports impossible pairing quickly', () => {
    const t = makeTournament(4);
    for (let r = 1; r <= 3; r++) {
      const res = pairSwiss(t, r, []);
      if (!res.ok) throw new Error(res.error);
      t.rounds.push({ number: r, halfByes: [], pairings: res.pairings.map((p) => ({ ...p, result: '½-½' })) });
    }
    const start = Date.now();
    const res = pairSwiss(t, 4, []);
    expect(res.ok).toBe(false);
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it('round 1 pairs top half against bottom half', () => {
    const t = makeTournament(8);
    const res = pairSwiss(t, 1, []);
    if (!res.ok) throw new Error(res.error);
    const pairs = res.pairings.map((p) => [p.white, p.black].sort());
    expect(pairs).toEqual([
      ['p1', 'p5'],
      ['p2', 'p6'],
      ['p3', 'p7'],
      ['p4', 'p8'],
    ]);
  });

  it('round 1 colors alternate down the boards', () => {
    const t = makeTournament(8);
    const res = pairSwiss(t, 1, []);
    if (!res.ok) throw new Error(res.error);
    expect(res.pairings.map((p) => p.white)).toEqual(['p1', 'p6', 'p3', 'p8']);
  });

  it('orders tables by top score, then combined score, then rank', () => {
    const t = makeTournament(8);
    // After round 1: p1, p2, p3 win; p4–p5 draw; p6, p7, p8 lose.
    t.rounds = [
      {
        number: 1,
        halfByes: [],
        pairings: [
          { board: 1, white: 'p1', black: 'p5', result: '1-0' },
          { board: 2, white: 'p6', black: 'p2', result: '0-1' },
          { board: 3, white: 'p3', black: 'p7', result: '1-0' },
          { board: 4, white: 'p8', black: 'p4', result: '½-½' },
        ],
      },
    ];
    const res = pairSwiss(t, 2, []);
    if (!res.ok) throw new Error(res.error);
    const scores = new Map([['p1', 1], ['p2', 1], ['p3', 1], ['p4', 0.5], ['p5', 0.5], ['p6', 0], ['p7', 0], ['p8', 0]]);
    const keys = res.pairings.map((p) => {
      const a = scores.get(p.white)!;
      const b = scores.get(p.black!)!;
      return [Math.max(a, b), a + b];
    });
    for (let i = 1; i < keys.length; i++) {
      const [top, sum] = keys[i];
      const [prevTop, prevSum] = keys[i - 1];
      expect(top < prevTop || (top === prevTop && sum <= prevSum)).toBe(true);
    }
    // The leader always sits on table 1.
    expect([res.pairings[0].white, res.pairings[0].black]).toContain('p1');
  });

  it('excludes half-bye players and gives bye to lowest', () => {
    const t = makeTournament(6);
    const res = pairSwiss(t, 1, ['p1']);
    if (!res.ok) throw new Error(res.error);
    expect(res.pairings.some((p) => p.white === 'p1' || p.black === 'p1')).toBe(false);
    expect(res.pairings.find((p) => p.black === null)?.white).toBe('p6');
  });
});

describe('round robin', () => {
  it('round count never drops below 1', () => {
    expect(rrTotalRounds(0)).toBe(1);
    expect(rrTotalRounds(1)).toBe(1);
    expect(rrTotalRounds(6)).toBe(5);
  });

  for (const n of [4, 6, 8, 10, 12]) {
    it(`berger n=${n}: every pair once, colors balanced`, () => {
      const met = new Set<string>();
      const diff = new Array(n).fill(0);
      for (let r = 1; r <= n - 1; r++) {
        const seen = new Set<number>();
        for (const [w, b] of bergerRound(n, r)) {
          const key = [w, b].sort((x, y) => x - y).join('-');
          expect(met.has(key)).toBe(false);
          met.add(key);
          seen.add(w).add(b);
          diff[w]++;
          diff[b]--;
        }
        expect(seen.size).toBe(n);
      }
      expect(met.size).toBe((n * (n - 1)) / 2);
      for (const d of diff) expect(Math.abs(d)).toBeLessThanOrEqual(1);
    });
  }

  it('odd field gives one bye per round, each player once', () => {
    const order = ['a', 'b', 'c', 'd', 'e'];
    expect(rrTotalRounds(5)).toBe(5);
    const byes: string[] = [];
    for (let r = 1; r <= 5; r++) {
      const ps = pairRoundRobin(order, r);
      const bye = ps.filter((p) => p.black === null);
      expect(bye).toHaveLength(1);
      byes.push(bye[0].white);
    }
    expect(new Set(byes).size).toBe(5);
  });
});

describe('tiebreaks', () => {
  // 4 players, 3 rounds, hand-built:
  // R1: A-B 1-0, C-D ½-½
  // R2: A-C ½-½, D-B 1-0
  // R3: A-D 0-1, B-C 0-1
  // Scores: A 1.5, B 0, C 2, D 2.5
  function fixture(): Tournament {
    const t = makeTournament(4);
    t.players = ['A', 'B', 'C', 'D'].map((id, i) => ({ id, name: id, rating: 2000 - i * 100, withdrawn: false }));
    t.tiebreaks = ['buchholz', 'buchholzCut1', 'sonnebornBerger', 'wins', 'aro'];
    t.rounds = [
      { number: 1, halfByes: [], pairings: [{ board: 1, white: 'A', black: 'B', result: '1-0' }, { board: 2, white: 'C', black: 'D', result: '½-½' }] },
      { number: 2, halfByes: [], pairings: [{ board: 1, white: 'A', black: 'C', result: '½-½' }, { board: 2, white: 'D', black: 'B', result: '1-0' }] },
      { number: 3, halfByes: [], pairings: [{ board: 1, white: 'A', black: 'D', result: '0-1' }, { board: 2, white: 'B', black: 'C', result: '0-1' }] },
    ];
    return t;
  }

  it('computes BH, BH-C1, SB, wins, ARO', () => {
    const rows = computeStandings(fixture(), 3);
    const get = (id: string) => rows.find((r) => r.player.id === id)!;
    expect(rows.map((r) => r.player.id)).toEqual(['D', 'C', 'A', 'B']);
    // A: opponents B 0, C 2, D 2.5
    expect(get('A').points).toBe(1.5);
    expect(get('A').tiebreaks.buchholz).toBe(4.5);
    expect(get('A').tiebreaks.buchholzCut1).toBe(4.5);
    expect(get('A').tiebreaks.sonnebornBerger).toBe(0 + 1); // beat B (0) + draw C (2/2)
    expect(get('A').tiebreaks.wins).toBe(1);
    expect(get('A').tiebreaks.aro).toBe(1800); // (1900+1800+1700)/3
  });

  it('uses own score for unplayed rounds in Buchholz', () => {
    const t = makeTournament(3);
    t.tiebreaks = ['buchholz'];
    t.rounds = [{ number: 1, halfByes: [], pairings: [{ board: 1, white: 'p1', black: 'p2', result: '1-0' }, { board: 2, white: 'p3', black: null, result: null }] }];
    const rows = computeStandings(t, 1);
    expect(rows.find((r) => r.player.id === 'p3')!.tiebreaks.buchholz).toBe(1);
  });

  it('direct encounter only when all tied players met', () => {
    const t = makeTournament(4);
    t.tiebreaks = ['directEncounter'];
    t.rounds = [
      { number: 1, halfByes: [], pairings: [{ board: 1, white: 'p1', black: 'p2', result: '0-1' }, { board: 2, white: 'p3', black: 'p4', result: '1-0' }] },
    ];
    const rows = computeStandings(t, 1);
    // p2 and p3 tied on 1 point but never met → DE 0 → shared rank 1
    expect(rows[0].rank).toBe(1);
    expect(rows[1].rank).toBe(1);
    // p1 and p4 tied on 0 and never met
    expect(rows[2].rank).toBe(3);
  });

  it('standings after an earlier round ignore later rounds', () => {
    const rows = computeStandings(fixture(), 1);
    expect(rows.find((r) => r.player.id === 'A')!.points).toBe(1);
    expect(rows.find((r) => r.player.id === 'A')!.summary.records).toHaveLength(1);
  });
});
