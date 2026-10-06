import type { Player } from '../engine/types';

/** 1.5 → "1½", 0.5 → "½", 2 → "2". */
export function fmtPoints(n: number): string {
  const whole = Math.floor(n);
  const half = n - whole >= 0.5;
  if (!half) return String(whole);
  return whole === 0 ? '½' : `${whole}½`;
}

export function fmtTiebreak(n: number | undefined): string {
  if (n === undefined) return '';
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, '');
}

export function playerLabel(p: Player | undefined): string {
  if (!p) return '?';
  return p.title ? `${p.title} ${p.name}` : p.name;
}
