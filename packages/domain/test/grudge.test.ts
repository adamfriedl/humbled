import { describe, expect, it } from "vitest";
import {
  advanceDaily,
  applyTrigger,
  clampAffinity,
  isSimilarTakeOutperformed,
  newRelationship,
  seededRandom,
  strongestRelationships,
  transitionPostFormat,
  type Relationship,
} from "../src/index.ts";
import { T0, always, cfg, days, never } from "./helpers.ts";

const g = cfg().grudge;
const rel = (over: Partial<Relationship> = {}): Relationship => ({
  ...newRelationship("me", "brad", T0),
  ...over,
});

describe("affinity", () => {
  it("clamps to [-1, 1]", () => {
    expect(clampAffinity(2)).toBe(1);
    expect(clampAffinity(-2)).toBe(-1);
    expect(newRelationship("a", "b", T0, -5).affinity).toBe(-1);
  });
  it("applyTrigger adjusts affinity and appends notes", () => {
    const r = applyTrigger(rel(), "similarPostOutperformed", g, "Brad stole my take");
    expect(r.affinity).toBeCloseTo(-0.25);
    expect(r.notes).toEqual(["Brad stole my take"]);
    expect(applyTrigger(r, "receivedComment", g).notes).toHaveLength(1);
  });
  it("similar-take trigger needs similarity and a real outperformance", () => {
    expect(isSimilarTakeOutperformed(0.9, 10, 20, g)).toBe(true);
    expect(isSimilarTakeOutperformed(0.85, 10, 20, g)).toBe(false);
    expect(isSimilarTakeOutperformed(0.9, 10, 14, g)).toBe(false);
    expect(isSimilarTakeOutperformed(0.9, 0, 2, g)).toBe(true);
  });
});

describe("advanceDaily (escalation ladder)", () => {
  it("neutral goes cold immediately once affinity drops", () => {
    const { relationship, transition } = advanceDaily(rel({ affinity: -0.2 }), T0, never, g);
    expect(relationship.stage).toBe("cold");
    expect(transition).toEqual({ from: "neutral", to: "cold" });
  });
  it("stays neutral when affinity is fine", () => {
    expect(advanceDaily(rel({ affinity: 0.1 }), T0, never, g).transition).toBeUndefined();
  });
  it("respects minimum dwell before escalating", () => {
    const cold = rel({ stage: "cold", affinity: -0.5, stageSince: T0 });
    expect(advanceDaily(cold, days(1.9), never, g).relationship.stage).toBe("cold");
    expect(advanceDaily(cold, days(2), never, g).relationship.stage).toBe("vague_posting");
  });
  it("cold thaws back to neutral if affinity recovers", () => {
    const r = advanceDaily(rel({ stage: "cold", affinity: 0.05 }), T0, never, g);
    expect(r.transition).toEqual({ from: "cold", to: "neutral" });
  });
  it("feud stages drift downward so they never stall", () => {
    const r = advanceDaily(rel({ stage: "vague_posting", affinity: -0.5 }), days(1), never, g);
    expect(r.relationship.affinity).toBeCloseTo(-0.56);
    expect(r.relationship.stage).toBe("vague_posting");
  });
  it("public exit reconciles with rising probability after dwell", () => {
    const exit = rel({ stage: "public_exit", affinity: -0.9, stageSince: T0 });
    expect(advanceDaily(exit, days(1), always, g).relationship.stage).toBe("public_exit");
    // day 2: p = 0.15
    expect(advanceDaily(exit, days(2), { next: () => 0.14 }, g).relationship.stage).toBe(
      "reconciled",
    );
    expect(advanceDaily(exit, days(2), { next: () => 0.16 }, g).relationship.stage).toBe(
      "public_exit",
    );
    // day 4: p = 0.45
    expect(advanceDaily(exit, days(4), { next: () => 0.44 }, g).relationship.stage).toBe(
      "reconciled",
    );
    // p caps at 1
    const r = advanceDaily(exit, days(30), never, g);
    expect(r.relationship).toMatchObject({ stage: "reconciled", affinity: 0.2 });
    expect(r.transition).toEqual({ from: "public_exit", to: "reconciled" });
  });
  it("reconciled settles to neutral after dwell, or reignites (the sequel)", () => {
    const rec = rel({ stage: "reconciled", affinity: 0.2, stageSince: T0 });
    expect(advanceDaily(rec, days(1), never, g).relationship.stage).toBe("reconciled");
    expect(advanceDaily(rec, days(2), never, g).relationship.stage).toBe("neutral");
    expect(advanceDaily({ ...rec, affinity: -0.3 }, days(2), never, g).relationship.stage).toBe(
      "cold",
    );
  });

  it("a full feud runs neutral -> reconciled in about 1 to 3 weeks", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const random = seededRandom(seed);
      let r = rel({ affinity: -0.45 });
      const visited: string[] = [r.stage];
      let day = 0;
      while (r.stage !== "reconciled" && day < 60) {
        r = advanceDaily(r, days(day), random, g).relationship;
        if (visited[visited.length - 1] !== r.stage) visited.push(r.stage);
        day++;
      }
      expect(visited).toEqual([
        "neutral",
        "cold",
        "vague_posting",
        "comment_war",
        "public_exit",
        "reconciled",
      ]);
      expect(day).toBeGreaterThanOrEqual(8);
      expect(day).toBeLessThanOrEqual(21);
    }
  });
});

describe("helpers", () => {
  it("transitionPostFormat", () => {
    expect(transitionPostFormat({ from: "comment_war", to: "public_exit" })).toBe("public_exit");
    expect(transitionPostFormat({ from: "public_exit", to: "reconciled" })).toBe("reconciliation");
    expect(transitionPostFormat({ from: "neutral", to: "cold" })).toBeUndefined();
  });
  it("strongestRelationships prefers active feuds, then extremity", () => {
    const rs = [
      rel({ to: "a", affinity: 0.9 }),
      rel({ to: "b", stage: "cold", affinity: -0.3 }),
      rel({ to: "c", stage: "comment_war", affinity: -0.7 }),
      rel({ to: "d", affinity: 0.1 }),
    ];
    expect(strongestRelationships(rs, 3).map((r) => r.to)).toEqual(["c", "b", "a"]);
  });
});
