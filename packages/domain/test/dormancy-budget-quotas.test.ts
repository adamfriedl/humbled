import { describe, expect, it } from "vitest";
import {
  budgetDecision,
  canComment,
  canNudge,
  canPost,
  canReplyAtDepth,
  dormancyMultiplier,
  realtimeAllowed,
  replyCooldownOk,
} from "../src/index.ts";
import { T0, cfg, days } from "./helpers.ts";

const c = cfg();
const user = (lastSeen?: Date) => ({
  id: "u",
  type: "recruiter" as const,
  isHouse: false,
  frequency: "normal" as const,
  ...(lastSeen ? { ownerLastSeenAt: lastSeen } : {}),
});

describe("dormancyMultiplier (FR-16)", () => {
  it.each([
    [0, 1],
    [1.9, 1],
    [2, 0.5],
    [6.9, 0.5],
    [7, 0.1],
    [29.9, 0.1],
    [30, 0],
    [400, 0],
  ])("%s days since visit -> %s", (d, expected) => {
    expect(dormancyMultiplier(user(T0), days(d), c.dormancy)).toBe(expected);
  });
  it("house bots are never dormant", () => {
    expect(dormancyMultiplier({ ...user(T0), isHouse: true }, days(100), c.dormancy)).toBe(1);
  });
  it("user personas with no visit are dormant; future visits clamp to 0 days", () => {
    expect(dormancyMultiplier(user(), T0, c.dormancy)).toBe(0);
    expect(dormancyMultiplier(user(days(1)), T0, c.dormancy)).toBe(1);
  });
});

describe("budgetDecision (CR-7)", () => {
  it("normal under 80%", () => {
    expect(budgetDecision(3.99, c.budget)).toEqual({ mode: "normal", activityMultiplier: 1 });
  });
  it("throttled from 80%", () => {
    expect(budgetDecision(4, c.budget)).toEqual({ mode: "throttled", activityMultiplier: 0.5 });
  });
  it("paused at 100% and when budget is zero", () => {
    expect(budgetDecision(5, c.budget).mode).toBe("generation_paused");
    expect(budgetDecision(0, cfg({ budget: { dailyLlmBudgetUsd: 0 } }).budget).mode).toBe(
      "generation_paused",
    );
  });
  it("tiny budget pauses (Phase 1 verification scenario)", () => {
    expect(budgetDecision(0.011, cfg({ budget: { dailyLlmBudgetUsd: 0.01 } }).budget).mode).toBe(
      "generation_paused",
    );
  });
  it("realtime budget is separate", () => {
    expect(realtimeAllowed(0.99, c.budget)).toBe(true);
    expect(realtimeAllowed(1, c.budget)).toBe(false);
  });
});

describe("quotas (CR-6)", () => {
  const q = c.quotas;
  it("daily caps", () => {
    expect(canPost({ posts: 3, comments: 0, nudges: 0 }, q)).toBe(true);
    expect(canPost({ posts: 4, comments: 0, nudges: 0 }, q)).toBe(false);
    expect(canComment({ posts: 0, comments: 14, nudges: 0 }, q)).toBe(true);
    expect(canComment({ posts: 0, comments: 15, nudges: 0 }, q)).toBe(false);
    expect(canNudge({ posts: 0, comments: 0, nudges: 0 }, q)).toBe(true);
    expect(canNudge({ posts: 0, comments: 0, nudges: 1 }, q)).toBe(false);
  });
  it("depth cap 3", () => {
    expect(canReplyAtDepth(2, q)).toBe(true);
    expect(canReplyAtDepth(3, q)).toBe(false);
  });
  it("reply cooldown 60 minutes", () => {
    const m = new Map([["brad", T0]]);
    expect(replyCooldownOk("brad", m, new Date(T0.getTime() + 59 * 60_000), q)).toBe(false);
    expect(replyCooldownOk("brad", m, new Date(T0.getTime() + 60 * 60_000), q)).toBe(true);
    expect(replyCooldownOk("chad", m, T0, q)).toBe(true);
  });
});
