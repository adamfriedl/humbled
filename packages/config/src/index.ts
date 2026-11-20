import { z } from "zod";

/**
 * All tunables live here (PRD: "Config, not constants"). Every field has a documented
 * default so `loadConfig({})` yields a working configuration for local dev and simulation.
 */

const probability = z.number().min(0).max(1);
const thinkingMode = z.enum(["off", "low", "medium"]).default("off");

export const DormancyTierSchema = z.object({
  /** Owner last seen strictly less than this many days ago. */
  maxDaysSinceVisit: z.number().positive(),
  multiplier: probability,
});

export const ConfigSchema = z.object({
  tick: z
    .object({
      /** Minutes between simulation ticks (FR-12). */
      intervalMinutes: z.number().int().positive().default(15),
    })
    .prefault({}),

  budget: z
    .object({
      /** CR-7: daily ceiling for batch/tick generation. */
      dailyLlmBudgetUsd: z.number().nonnegative().default(5),
      /** CR-7: separate ceiling for real-time calls (first posts, nudges). */
      dailyRealtimeBudgetUsd: z.number().nonnegative().default(1),
      /** Fraction of the daily budget at which activity is throttled. */
      softLimitFraction: probability.default(0.8),
      /** Activity multiplier applied between the soft and hard limit. */
      softLimitActivityMultiplier: probability.default(0.5),
    })
    .prefault({}),

  quotas: z
    .object({
      /** CR-6 per persona per day. */
      postsPerDay: z.number().int().nonnegative().default(4),
      commentsPerDay: z.number().int().nonnegative().default(15),
      nudgesPerDay: z.number().int().nonnegative().default(1),
      /** Comment depth cap; top-level comment is depth 1. */
      maxReplyDepth: z.number().int().positive().default(3),
      /** Bots never reply to a bot they replied to within this window. */
      replyCooldownMinutes: z.number().int().nonnegative().default(60),
    })
    .prefault({}),

  /** FR-16. Tiers are evaluated in ascending order; past the last tier the multiplier is 0. */
  dormancy: z
    .array(DormancyTierSchema)
    .min(1)
    .default([
      { maxDaysSinceVisit: 2, multiplier: 1 },
      { maxDaysSinceVisit: 7, multiplier: 0.5 },
      { maxDaysSinceVisit: 30, multiplier: 0.1 },
    ]),

  planner: z
    .object({
      /** Multipliers for a persona's posting-frequency setting. */
      frequencyMultipliers: z
        .object({
          low: z.number().nonnegative(),
          normal: z.number().nonnegative(),
          high: z.number().nonnegative(),
        })
        .default({ low: 0.5, normal: 1, high: 1.6 }),
      /** Multiplier on post probability on a world-event day for personas who have not reacted yet. */
      eventDayPostBoost: z.number().nonnegative().default(1.5),
      /** Probability a planned post on an event day is an Event Reaction, until the persona has made one. */
      eventReactionShare: probability.default(0.6),
      /** Max feed items a persona considers per tick when picking comment/react targets. */
      feedSampleSize: z.number().int().positive().default(12),
    })
    .prefault({}),

  grudge: z
    .object({
      /** Minimum days in a stage before moving on (FR-19). */
      minDwellDays: z.number().nonnegative().default(2),
      /** Affinity at or below which a relationship escalates into each stage. */
      thresholds: z
        .object({
          cold: z.number().min(-1).max(1),
          vaguePosting: z.number().min(-1).max(1),
          commentWar: z.number().min(-1).max(1),
          publicExit: z.number().min(-1).max(1),
        })
        .default({ cold: -0.2, vaguePosting: -0.4, commentWar: -0.6, publicExit: -0.8 }),
      /** Affinity above which a cold relationship thaws back to neutral. */
      thawAbove: z.number().min(-1).max(1).default(0),
      /** Daily reconciliation probability on the first eligible day after the exit dwell. */
      reconciliationBaseDailyProbability: probability.default(0.15),
      /** Added to the daily probability for each further day spent in the exit stage. */
      reconciliationDailyIncrement: probability.default(0.15),
      /** Affinity after reconciliation. */
      reconciledAffinity: z.number().min(-1).max(1).default(0.2),
      /**
       * Feuds feed themselves: daily affinity drop while in vague_posting or comment_war,
       * so a feud never stalls just below a threshold.
       */
      feudDriftPerDay: z.number().nonnegative().default(0.06),
      /** FR-18: affinity change applied to the aggrieved side for each trigger. */
      triggerDeltas: z
        .object({
          similarPostOutperformed: z.number(),
          pushBackComment: z.number(),
          rivalTopVoiceFirst: z.number(),
          unreciprocatedEndorsement: z.number(),
          receivedPositiveReaction: z.number(),
          receivedComment: z.number(),
        })
        .default({
          similarPostOutperformed: -0.25,
          pushBackComment: -0.15,
          rivalTopVoiceFirst: -0.3,
          unreciprocatedEndorsement: -0.1,
          receivedPositiveReaction: 0.01,
          receivedComment: 0.02,
        }),
      /** FR-18: cosine similarity above which two posts count as "the same take". */
      similarTakeCosine: probability.default(0.85),
      /** FR-18: the rival's post must outperform yours by this factor to sting. */
      outperformFactor: z.number().positive().default(1.5),
    })
    .prefault({}),

  /** FR-9: engagement scoring and reach. */
  engagement: z
    .object({
      reactionWeight: z.number().nonnegative().default(1),
      commentWeight: z.number().nonnegative().default(3),
      shareWeight: z.number().nonnegative().default(5),
      /** Human reactions count this many times a bot reaction. */
      humanReactionWeight: z.number().nonnegative().default(2),
      /** Cringe bonus multiplier per judge point above 3 (negative below). */
      cringeBonusPerPoint: z.number().nonnegative().default(0.25),
      /** Reach halves every this many hours (feed sampling recency decay). */
      reachHalfLifeHours: z.number().positive().default(12),
    })
    .prefault({}),

  comedy: z
    .object({
      /** FR-20: share of posts that carry grudge or callback content. */
      grudgeOrCallbackShare: probability.default(0.25),
      /** A persona never repeats a format used in its last N posts. */
      formatNoRepeatWindow: z.number().int().nonnegative().default(5),
      /**
       * Best-of-N for posts: generate N candidates in one call and let the judge pick one
       * (ADR 0005). 1 disables selection. Comments are always single-shot.
       */
      postCandidates: z.number().int().min(1).max(5).default(3),
      /** Few-shot golden examples per generation call (PRD: rotate 2 to 3). */
      fewShotExamples: z.number().int().min(0).max(5).default(3),
      /** Post and comment word ranges (house style). */
      postWords: z
        .object({ min: z.number().int().positive(), max: z.number().int().positive() })
        .default({ min: 40, max: 180 }),
      commentWords: z
        .object({ min: z.number().int().positive(), max: z.number().int().positive() })
        .default({ min: 5, max: 40 }),
      /** Accept generated text within this fraction outside the word range before rejecting it. */
      lengthTolerance: z.number().min(0).max(1).default(0.2),
      /** Reject a candidate whose word-trigram Jaccard overlap with a recent own post exceeds this. */
      maxTrigramOverlap: probability.default(0.3),
      /** How many of the persona's recent posts to compare against for repetition. */
      repetitionWindow: z.number().int().nonnegative().default(10),
      /** Max feed posts shown in a generation prompt (CR-4 trims further if needed). */
      promptFeedItems: z.number().int().nonnegative().default(4),
      /** Judge: minimum `safe` score a candidate needs to be eligible. */
      minSafeScore: z.number().int().min(1).max(5).default(4),
    })
    .prefault({}),

  llm: z
    .object({
      /** CR-1: model is config, not code. */
      models: z
        .object({
          post: z.string().default("claude-haiku-5-5"),
          comment: z.string().default("claude-haiku-5-5"),
          summary: z.string().default("claude-haiku-5-5"),
          judge: z.string().default("claude-haiku-5-5"),
          relationshipNote: z.string().default("claude-haiku-5-5"),
        })
        .prefault({}),
      /**
       * CR-4. Hard input budget per prompt (estimated tokens). 5,000 leaves room for a full feed
       * sample on top of the ~3,000-token cached house style and examples (ADR 0008).
       */
      maxInputTokens: z.number().int().positive().default(5000),
      /** CR-5. */
      maxOutputTokens: z
        .object({
          post: z.number().int().positive(),
          comment: z.number().int().positive(),
          summary: z.number().int().positive(),
          judge: z.number().int().positive(),
          relationshipNote: z.number().int().positive(),
        })
        .default({ post: 400, comment: 120, summary: 900, judge: 200, relationshipNote: 60 }),
      /**
       * Thinking per call type (ADR 0003). "off" disables thinking; "low"/"medium" run adaptive
       * thinking at that effort. Haiku 5.5 thinks by default, and thinking bills as output.
       */
      thinking: z
        .object({
          post: thinkingMode,
          comment: thinkingMode,
          summary: thinkingMode,
          judge: thinkingMode,
          relationshipNote: thinkingMode,
        })
        .prefault({}),
      /**
       * USD per million tokens, per model, at the ≤100K-prompt rate. Cache reads, cache writes
       * and batch discount are multipliers on these. Keep in sync with Anthropic's price list.
       */
      pricing: z
        .record(
          z.string(),
          z.object({
            inputPerMTok: z.number().nonnegative(),
            outputPerMTok: z.number().nonnegative(),
          }),
        )
        .default({ "claude-haiku-5-5": { inputPerMTok: 0.1, outputPerMTok: 0.5 } }),
      cacheReadMultiplier: z.number().nonnegative().default(0.1),
      cacheWriteMultiplier: z.number().nonnegative().default(1.25),
      batchDiscount: z.number().min(0).max(1).default(0.5),
      /**
       * API base URL, set explicitly so the SDK never inherits an ANTHROPIC_BASE_URL meant for
       * another tool in the environment.
       */
      baseURL: z.string().url().default("https://api.anthropic.com"),
      /** Hours after which an open batch is logged as late (CR-3). */
      batchSlaHours: z.number().positive().default(2),
    })
    .prefault({}),

  /** Phase 0 gate thresholds, checked by the simulation harness. */
  eval: z
    .object({
      minAvgFunny: z.number().min(1).max(5).default(3.5),
      minTypeAvgFunny: z.number().min(1).max(5).default(3),
      /** Projected (batch-priced) LLM cost per persona per simulated day. */
      maxCostPerPersonaDayUsd: z.number().nonnegative().default(0.005),
      /** A type's posts "converge" when their mean pairwise trigram overlap exceeds this. */
      maxTypeTrigramOverlap: probability.default(0.08),
    })
    .prefault({}),

  limits: z
    .object({
      /** FR-5. */
      personasPerOwner: z.number().int().positive().default(3),
      creationsPerIpPerDay: z.number().int().positive().default(5),
    })
    .prefault({}),

  web: z
    .object({
      /** FR-7: posts per feed page (the server-rendered first page and each scroll fetch). */
      feedPageSize: z.number().int().positive().max(100).default(20),
      /** FR-7: how far back "Trending" looks. Older posts drop off however well they did. */
      trendingWindowDays: z.number().int().positive().default(7),
      /** FR-11: rivalries shown as "People also viewed" on a profile. */
      profileRivalries: z.number().int().nonnegative().default(3),
      /** SR-5: reactions one browser (owner cookie) may set or change per minute. */
      reactionsPerOwnerPerMinute: z.number().int().positive().default(20),
      /**
       * SR-5: reactions per hour from one IP address, across cookies. Clearing cookies is free,
       * so this is the limit that stops a script; it's generous for shared networks.
       */
      reactionsPerIpPerHour: z.number().int().positive().default(300),
    })
    .prefault({}),
});

export type Config = z.infer<typeof ConfigSchema>;
export type ConfigInput = z.input<typeof ConfigSchema>;
export type DormancyTier = z.infer<typeof DormancyTierSchema>;

/** Parse and validate config, filling defaults. Throws a ZodError on invalid input. */
export function loadConfig(input: ConfigInput = {}): Config {
  const config = ConfigSchema.parse(input);
  const tiers = config.dormancy;
  for (let i = 1; i < tiers.length; i++) {
    if (tiers[i]!.maxDaysSinceVisit <= tiers[i - 1]!.maxDaysSinceVisit) {
      throw new Error(
        "config.dormancy tiers must be in strictly ascending maxDaysSinceVisit order",
      );
    }
  }
  const t = config.grudge.thresholds;
  if (!(t.cold > t.vaguePosting && t.vaguePosting > t.commentWar && t.commentWar > t.publicExit)) {
    throw new Error("config.grudge.thresholds must strictly decrease from cold to publicExit");
  }
  return config;
}

export const defaultConfig: Config = loadConfig();

/**
 * Overrides from a JSON string, such as the worker's `HUMBLED_CONFIG` environment variable.
 * Unset or blank means no overrides. The result still goes through `loadConfig`, which
 * validates it, so a typo'd value fails at startup instead of running on a silent default.
 */
export function configOverrides(json: string | undefined): ConfigInput {
  if (json === undefined || json.trim() === "") return {};
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("config overrides must be a JSON object");
  }
  return parsed as ConfigInput;
}
