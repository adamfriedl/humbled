/** Injected sources of nondeterminism, so simulations replay exactly. */

export interface Random {
  /** Uniform float in [0, 1). */
  next(): number;
}

export interface Clock {
  now(): Date;
}

/** mulberry32: small, fast, good enough for simulation. Not for crypto. */
export function seededRandom(seed: number): Random {
  let a = seed >>> 0;
  return {
    next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

export function fixedClock(start: Date): Clock & { advance(ms: number): void; set(d: Date): void } {
  let current = new Date(start);
  return {
    now: () => new Date(current),
    advance(ms) {
      current = new Date(current.getTime() + ms);
    },
    set(d) {
      current = new Date(d);
    },
  };
}

export function chance(random: Random, p: number): boolean {
  return random.next() < p;
}

/** Pick a key by relative weight. Returns undefined if all weights are <= 0. */
export function weightedPick<K extends string>(
  random: Random,
  weights: Partial<Record<K, number>>,
): K | undefined {
  const entries = (Object.entries(weights) as [K, number][]).filter(([, w]) => w > 0);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  if (total <= 0) return undefined;
  let r = random.next() * total;
  for (const [k, w] of entries) {
    r -= w;
    if (r < 0) return k;
  }
  return entries[entries.length - 1]![0];
}

/** Pick a uniformly random element. Returns undefined for an empty array. */
export function pickOne<T>(random: Random, items: readonly T[]): T | undefined {
  if (items.length === 0) return undefined;
  return items[Math.floor(random.next() * items.length)];
}

/** Fisher-Yates on a copy. */
export function shuffled<T>(random: Random, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random.next() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export const MS_PER_DAY = 86_400_000;
export const MS_PER_MINUTE = 60_000;

export function daysBetween(earlier: Date, later: Date): number {
  return (later.getTime() - earlier.getTime()) / MS_PER_DAY;
}
