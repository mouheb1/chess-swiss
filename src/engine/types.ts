export type Result = '1-0' | '0-1' | '½-½' | '+/-' | '-/+' | '0-0' | null;

export type TiebreakId =
  | 'buchholz'
  | 'buchholzCut1'
  | 'sonnebornBerger'
  | 'wins'
  | 'directEncounter'
  | 'aro';

export type System = 'swiss' | 'roundrobin';

export interface Player {
  id: string;
  name: string;
  rating: number;
  title?: string;
  fed?: string;
  club?: string;
  withdrawn: boolean;
}

/** black === null means the white player received the pairing bye. */
export interface Pairing {
  board: number;
  white: string;
  black: string | null;
  result: Result;
}

export interface Round {
  number: number;
  pairings: Pairing[];
  /** Players who requested a half-point bye for this round. */
  halfByes: string[];
}

export interface Tournament {
  name: string;
  location: string;
  arbiter: string;
  startDate: string;
  system: System;
  totalRounds: number;
  byePoints: 1 | 0.5;
  tiebreaks: TiebreakId[];
  players: Player[];
  rounds: Round[];
  /** Half-point byes requested for the next round to be paired (Swiss only). */
  pendingHalfByes: string[];
  /** Fixed round-robin seating (player ids), set when round 1 is paired. */
  rrOrder: string[];
}

export const TIEBREAK_LABELS: Record<TiebreakId, string> = {
  buchholz: 'Buchholz',
  buchholzCut1: 'Buchholz Cut-1',
  sonnebornBerger: 'Sonneborn-Berger',
  wins: 'Wins',
  directEncounter: 'Direct encounter',
  aro: 'Avg. rating of opponents',
};

export const TIEBREAK_SHORT: Record<TiebreakId, string> = {
  buchholz: 'BH',
  buchholzCut1: 'BH-C1',
  sonnebornBerger: 'SB',
  wins: 'Wins',
  directEncounter: 'DE',
  aro: 'ARO',
};

export const DEFAULT_TIEBREAKS: Record<System, TiebreakId[]> = {
  swiss: ['buchholzCut1', 'buchholz', 'sonnebornBerger', 'wins'],
  roundrobin: ['directEncounter', 'sonnebornBerger', 'wins'],
};
