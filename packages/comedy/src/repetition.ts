/** Repetition checks (PRD "Repetition metrics"). Embedding similarity lives behind Embedder. */

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/#\w+/g, " ")
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function wordCount(text: string): number {
  return words(text).length;
}

export function trigrams(text: string): Set<string> {
  const w = words(text);
  const out = new Set<string>();
  for (let i = 0; i + 2 < w.length; i++) out.add(`${w[i]} ${w[i + 1]} ${w[i + 2]}`);
  return out;
}

export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Highest trigram overlap between `text` and any of `recent`. */
export function maxTrigramOverlap(text: string, recent: readonly string[]): number {
  const t = trigrams(text);
  return recent.reduce((max, r) => Math.max(max, jaccard(t, trigrams(r))), 0);
}

/** First `n` words, normalized, for "don't open the same way twice". */
export function opening(text: string, n = 6): string {
  return words(text).slice(0, n).join(" ");
}

/** Mean pairwise overlap within a set of posts: a convergence signal for a persona type. */
export function meanPairwiseOverlap(posts: readonly string[]): number {
  const grams = posts.map(trigrams);
  let sum = 0;
  let pairs = 0;
  for (let i = 0; i < grams.length; i++) {
    for (let j = i + 1; j < grams.length; j++) {
      sum += jaccard(grams[i]!, grams[j]!);
      pairs++;
    }
  }
  return pairs === 0 ? 0 : sum / pairs;
}
