import { describe, expect, it } from 'vitest';
import { pairSwiss } from '../engine/swiss';
import { emptyTournament, exportJson, parseTournamentJson } from './serialize';

describe('export / import', () => {
  it('round-trips a tournament with players and rounds', () => {
    const t = emptyTournament();
    t.name = 'Club Open';
    t.players = ['a', 'b', 'c'].map((id, i) => ({ id, name: id.toUpperCase(), rating: 1800 - i * 50, withdrawn: false }));
    const res = pairSwiss(t, 1, []);
    if (!res.ok) throw new Error(res.error);
    t.rounds = [{ number: 1, halfByes: [], pairings: res.pairings.map((p) => ({ ...p, result: p.black ? '½-½' : null })) }];

    const back = parseTournamentJson(exportJson(t));
    expect(back.ok && back.tournament).toEqual(t);
  });

  it('rejects invalid JSON and wrong shapes', () => {
    expect(parseTournamentJson('{nope').ok).toBe(false);
    expect(parseTournamentJson('{"players": []}').ok).toBe(false);
    expect(parseTournamentJson('{"name":"x","system":"swiss","totalRounds":5,"players":[{"id":1}],"rounds":[]}').ok).toBe(false);
  });

  it('fills fields missing from older files', () => {
    const res = parseTournamentJson(
      JSON.stringify({ name: 'Old', system: 'swiss', totalRounds: 3, players: [{ id: 'x', name: 'X', rating: 0 }], rounds: [{ number: 1, pairings: [] }] }),
    );
    if (!res.ok) throw new Error(res.error);
    expect(res.tournament.rounds[0].halfByes).toEqual([]);
    expect(res.tournament.players[0].withdrawn).toBe(false);
    expect(res.tournament.pendingHalfByes).toEqual([]);
  });
});
