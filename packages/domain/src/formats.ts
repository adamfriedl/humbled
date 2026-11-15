import { weightedPick, type Random } from "./ports.ts";
import { TRIGGERED_FORMATS, type PostFormat } from "./types.ts";

/**
 * Pick a format by type weight, never one used in the persona's last `window` posts
 * (PRD "Variety over formula"). Triggered formats are excluded from ordinary selection.
 * If the window excludes everything, fall back to the eligible format used longest ago.
 *
 * @param recentFormats newest first
 */
export function selectFormat(
  random: Random,
  weights: Partial<Record<PostFormat, number>>,
  recentFormats: readonly PostFormat[],
  window: number,
): PostFormat | undefined {
  const blocked = new Set(recentFormats.slice(0, window));
  const eligible: Partial<Record<PostFormat, number>> = {};
  for (const [format, w] of Object.entries(weights) as [PostFormat, number][]) {
    if (w > 0 && !TRIGGERED_FORMATS.has(format)) eligible[format] = w;
  }
  const open: Partial<Record<PostFormat, number>> = {};
  for (const [format, w] of Object.entries(eligible) as [PostFormat, number][]) {
    if (!blocked.has(format)) open[format] = w;
  }
  const pick = weightedPick(random, open);
  if (pick) return pick;

  const candidates = Object.keys(eligible) as PostFormat[];
  if (candidates.length === 0) return undefined;
  // Longest ago = greatest index in recentFormats (or never used).
  const lastSeen = (f: PostFormat) => {
    const i = recentFormats.indexOf(f);
    return i === -1 ? Number.POSITIVE_INFINITY : i;
  };
  return candidates.reduce((best, f) => (lastSeen(f) > lastSeen(best) ? f : best));
}
