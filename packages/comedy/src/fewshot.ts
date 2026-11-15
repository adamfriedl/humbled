import type { GoldenPost } from "@humbled/content";
import { shuffled, type PersonaType, type Random } from "@humbled/domain";

/**
 * Pick few-shot examples: one anchor (any type) for the comedy bar, then approved posts of the
 * same persona type for voice, then any approved post. Never the same post twice.
 */
export function pickFewShot(
  golden: readonly GoldenPost[],
  type: PersonaType,
  n: number,
  random: Random,
): GoldenPost[] {
  if (n <= 0) return [];
  const approved = golden.filter((g) => g.approved);
  const picked: GoldenPost[] = [];
  const take = (pool: GoldenPost[], max: number) => {
    for (const g of shuffled(random, pool)) {
      if (picked.length >= n || max <= 0) return;
      if (!picked.includes(g)) {
        picked.push(g);
        max--;
      }
    }
  };
  take(
    approved.filter((g) => g.anchor),
    1,
  );
  take(
    approved.filter((g) => g.type === type),
    n,
  );
  take(approved, n);
  return picked;
}
