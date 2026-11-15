import { describe, expect, it } from "vitest";
import { defaultConfig, loadConfig } from "../src/index.ts";

describe("loadConfig", () => {
  it("fills PRD defaults", () => {
    expect(defaultConfig.tick.intervalMinutes).toBe(15);
    expect(defaultConfig.budget.dailyLlmBudgetUsd).toBe(5);
    expect(defaultConfig.quotas).toMatchObject({
      postsPerDay: 4,
      commentsPerDay: 15,
      maxReplyDepth: 3,
    });
    expect(defaultConfig.llm.models.post).toBe("claude-haiku-5-5");
    expect(defaultConfig.llm.maxOutputTokens.post).toBe(400);
    expect(defaultConfig.grudge.minDwellDays).toBe(2);
    expect(defaultConfig.comedy.postCandidates).toBe(3);
  });
  it("merges partial overrides", () => {
    const c = loadConfig({ budget: { dailyLlmBudgetUsd: 0.01 } });
    expect(c.budget.dailyLlmBudgetUsd).toBe(0.01);
    expect(c.budget.softLimitFraction).toBe(0.8);
  });
  it("rejects invalid values", () => {
    expect(() => loadConfig({ comedy: { grudgeOrCallbackShare: 2 } })).toThrow();
  });
  it("rejects unordered dormancy tiers", () => {
    expect(() =>
      loadConfig({
        dormancy: [
          { maxDaysSinceVisit: 7, multiplier: 0.5 },
          { maxDaysSinceVisit: 2, multiplier: 1 },
        ],
      }),
    ).toThrow(/ascending/);
  });
  it("rejects non-decreasing grudge thresholds", () => {
    expect(() =>
      loadConfig({
        grudge: {
          thresholds: { cold: -0.5, vaguePosting: -0.4, commentWar: -0.6, publicExit: -0.8 },
        },
      }),
    ).toThrow(/decrease/);
  });
});
