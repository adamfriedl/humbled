import { loadConfig, type ConfigInput } from "@humbled/config";
import type { PlanInput } from "../src/planner.ts";
import type { PersonaTypeProfile, Random } from "../src/index.ts";

export const T0 = new Date("2026-11-01T12:00:00Z");
export const days = (n: number) => new Date(T0.getTime() + n * 86_400_000);

export const cfg = (input: ConfigInput = {}) => loadConfig(input);

/** A Random that returns a fixed sequence, then repeats the last value. */
export function scripted(...values: number[]): Random {
  let i = 0;
  return { next: () => values[Math.min(i++, values.length - 1)]! };
}

export const always: Random = { next: () => 0 };
export const never: Random = { next: () => 0.999999 };

export const profile: PersonaTypeProfile = {
  type: "hustle_bro",
  actionRates: { post: 0.5, comment: 0.5, reply: 0.5, react: 0.5, follow: 0.5, endorse: 0.5 },
  formatWeights: { lesson: 3, humblebrag: 1, contrarian: 1, vague_post: 5, milestone: 5 },
  reactionWeights: { like: 1, celebrate: 1 },
};

export function planInput(over: Partial<PlanInput> = {}): PlanInput {
  return {
    persona: { id: "me", type: "hustle_bro", isHouse: true, frequency: "normal" },
    profile,
    counts: { posts: 0, comments: 0, nudges: 0 },
    activityMultiplier: 1,
    generationAllowed: true,
    relationships: [],
    feed: [
      { postId: "p1", authorId: "brad", engagementScore: 10, createdAt: T0 },
      { postId: "p2", authorId: "me", engagementScore: 10, createdAt: T0 },
    ],
    recentFormats: [],
    replyCandidates: [],
    lastRepliedAt: new Map(),
    following: new Set(),
    endorsed: new Set(),
    commentedPostIds: new Set(),
    now: T0,
    ...over,
  };
}
