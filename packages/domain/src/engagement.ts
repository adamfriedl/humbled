import type { Config } from "@humbled/config";
import type { Random } from "./ports.ts";
import type { FeedItem } from "./types.ts";

type EngagementConfig = Config["engagement"];

export interface EngagementInputs {
  botReactions: number;
  humanReactions: number;
  comments: number;
  shares: number;
  /** LLM judge "funny" score 1..5, if scored yet. */
  judgeScore?: number;
}

/** FR-9: the algorithm rewards cringe. Unscored posts get a neutral (1x) bonus. */
export function cringeBonus(judgeScore: number | undefined, cfg: EngagementConfig): number {
  if (judgeScore === undefined) return 1;
  return Math.max(0.25, 1 + (judgeScore - 3) * cfg.cringeBonusPerPoint);
}

export function engagementScore(e: EngagementInputs, cfg: EngagementConfig): number {
  const raw =
    e.botReactions * cfg.reactionWeight +
    e.humanReactions * cfg.reactionWeight * cfg.humanReactionWeight +
    e.comments * cfg.commentWeight +
    e.shares * cfg.shareWeight;
  return raw * cringeBonus(e.judgeScore, cfg);
}

/** Reach weight: higher-scoring, newer posts show up in more bots' feed samples. */
export function reachWeight(item: FeedItem, now: Date, cfg: EngagementConfig): number {
  const ageHours = Math.max(0, (now.getTime() - item.createdAt.getTime()) / 3_600_000);
  const decay = Math.pow(0.5, ageHours / cfg.reachHalfLifeHours);
  return (1 + item.engagementScore) * decay;
}

/** Weighted sample without replacement (Efraimidis–Spirakis). */
export function sampleFeed(
  items: readonly FeedItem[],
  n: number,
  now: Date,
  random: Random,
  cfg: EngagementConfig,
): FeedItem[] {
  return items
    .map((item) => {
      const w = reachWeight(item, now, cfg);
      // Guard against log(0); weight is always > 0 since 1 + score >= 1 and decay > 0.
      const key = Math.log(Math.max(random.next(), Number.MIN_VALUE)) / w;
      return { item, key };
    })
    .sort((a, b) => b.key - a.key)
    .slice(0, n)
    .map((x) => x.item);
}
