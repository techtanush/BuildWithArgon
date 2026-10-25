// OWNER: karthik — seed version; replace/extend freely but keep the exported names and signatures (mahin calls them).
// Viseme table + alignment lookup (architecture-files/05-world/05-characters-and-faces.md §Lip-sync).
import type { Alignment } from '../../shared/contracts';

export type Viseme = 'A' | 'E' | 'O' | 'U' | 'M' | 'F' | 'C' | 'Rest';
export interface MouthShape { open: number; width: number } // meters: open 0–0.07, width 0.05–0.10

export const VISEMES: Record<Viseme, MouthShape> = {
  A: { open: 0.065, width: 0.085 },
  E: { open: 0.035, width: 0.1 },
  O: { open: 0.055, width: 0.06 },
  U: { open: 0.03, width: 0.05 },
  M: { open: 0.0, width: 0.07 },
  F: { open: 0.012, width: 0.08 },
  C: { open: 0.025, width: 0.075 },
  Rest: { open: 0.004, width: 0.072 },
};
export const REST: MouthShape = VISEMES.Rest;

/** Maps a single normalized character, not arbitrary words. */
export function visemeForChar(ch: string): Viseme {
  const c = ch.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  if (c.length !== 1) return 'Rest';
  if ('ah'.includes(c)) return 'A';
  if ('eiy'.includes(c)) return 'E';
  if (c === 'o') return 'O';
  if ('uwq'.includes(c)) return 'U';
  if ('mbp'.includes(c)) return 'M';
  if ('fv'.includes(c)) return 'F';
  return 'lntdszckgjrx0123456789'.includes(c) ? 'C' : 'Rest';
}

/** Index k with starts[k] <= t < ends[k] (binary search), or -1. Seed: always -1. */
export function charIndexAt(alignment: Alignment, t: number): number {
  if (!Number.isFinite(t)) return -1;
  let lo = 0, hi = Math.min(alignment.chars.length, alignment.starts.length, alignment.ends.length) - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (alignment.starts[mid] > t) hi = mid - 1;
    else lo = mid + 1;
  }
  return hi >= 0 && t < alignment.ends[hi] ? hi : -1;
}
