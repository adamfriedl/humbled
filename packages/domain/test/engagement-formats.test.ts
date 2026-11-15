import { describe, expect, it } from "vitest";
import {
  cringeBonus,
  engagementScore,
  reachWeight,
  sampleFeed,
  seededRandom,
  selectFormat,
} from "../src/index.ts";
import { T0, cfg, scripted } from "./helpers.ts";

const e = cfg().engagement;

describe("engagement (FR-9)", () => {
  it("cringe bonus scales with judge score and is neutral when unscored", () => {
    expect(cringeBonus(undefined, e)).toBe(1);
    expect(cringeBonus(3, e)).toBe(1);
    expect(cringeBonus(5, e)).toBe(1.5);
    expect(cringeBonus(1, e)).toBe(0.5);
    expect(cringeBonus(-10, e)).toBe(0.25);
  });
  it("weights reactions, human reactions, comments and shares", () => {
    expect(
      engagementScore(
        { botReactions: 2, humanReactions: 1, comments: 1, shares: 1, judgeScore: 5 },
        e,
      ),
    ).toBe((2 + 2 + 3 + 5) * 1.5);
  });
  it("reach decays with age", () => {
    const item = { postId: "p", authorId: "a", engagementScore: 9, createdAt: T0 };
    expect(reachWeight(item, T0, e)).toBe(10);
    expect(reachWeight(item, new Date(T0.getTime() + 12 * 3_600_000), e)).toBeCloseTo(5);
    expect(reachWeight(item, new Date(T0.getTime() - 3_600_000), e)).toBe(10);
  });
  it("sampleFeed favors high-reach posts and returns at most n distinct items", () => {
    const items = [
      { postId: "hot", authorId: "a", engagementScore: 1000, createdAt: T0 },
      ...Array.from({ length: 20 }, (_, i) => ({
        postId: `p${i}`,
        authorId: "b",
        engagementScore: 0,
        createdAt: T0,
      })),
    ];
    const r = seededRandom(3);
    let hotHits = 0;
    for (let i = 0; i < 200; i++) {
      const s = sampleFeed(items, 3, T0, r, e);
      expect(new Set(s.map((x) => x.postId)).size).toBe(3);
      if (s.some((x) => x.postId === "hot")) hotHits++;
    }
    expect(hotHits).toBeGreaterThan(190);
  });
});

describe("selectFormat", () => {
  const w = { lesson: 1, listicle: 1, contrarian: 1, vague_post: 100, milestone: 100 } as const;
  it("never picks triggered formats", () => {
    const r = seededRandom(9);
    for (let i = 0; i < 200; i++)
      expect(["lesson", "listicle", "contrarian"]).toContain(selectFormat(r, w, [], 5));
  });
  it("avoids the no-repeat window", () => {
    expect(selectFormat(scripted(0), w, ["lesson", "listicle"], 5)).toBe("contrarian");
  });
  it("falls back to the format used longest ago when the window blocks everything", () => {
    expect(selectFormat(scripted(0), w, ["listicle", "contrarian", "lesson"], 5)).toBe("lesson");
    expect(selectFormat(scripted(0), { lesson: 1, listicle: 1 }, ["lesson"], 5)).toBe("listicle");
    expect(selectFormat(scripted(0), { lesson: 1, listicle: 1 }, ["lesson", "listicle"], 1)).toBe(
      "listicle",
    );
  });
  it("returns undefined with no eligible formats", () => {
    expect(selectFormat(scripted(0), { milestone: 1 }, [], 5)).toBeUndefined();
  });
});
