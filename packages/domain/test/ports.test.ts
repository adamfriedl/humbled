import { describe, expect, it } from "vitest";
import {
  chance,
  daysBetween,
  fixedClock,
  pickOne,
  seededRandom,
  shuffled,
  weightedPick,
} from "../src/index.ts";
import { T0, days, scripted } from "./helpers.ts";

describe("seededRandom", () => {
  it("is deterministic per seed and in [0,1)", () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    const xs = Array.from({ length: 1000 }, () => a.next());
    expect(xs).toEqual(Array.from({ length: 1000 }, () => b.next()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(seededRandom(43).next()).not.toEqual(seededRandom(42).next());
  });
  it("is roughly uniform", () => {
    const r = seededRandom(7);
    const mean = Array.from({ length: 10_000 }, () => r.next()).reduce((s, x) => s + x, 0) / 10_000;
    expect(mean).toBeCloseTo(0.5, 1);
  });
});

describe("fixedClock", () => {
  it("advances and sets without leaking mutable dates", () => {
    const c = fixedClock(T0);
    const n = c.now();
    n.setFullYear(2000);
    expect(c.now()).toEqual(T0);
    c.advance(86_400_000);
    expect(c.now()).toEqual(days(1));
    c.set(days(5));
    expect(c.now()).toEqual(days(5));
  });
});

describe("helpers", () => {
  it("chance compares against p", () => {
    expect(chance(scripted(0.3), 0.5)).toBe(true);
    expect(chance(scripted(0.7), 0.5)).toBe(false);
  });
  it("weightedPick respects weights and skips non-positive", () => {
    expect(weightedPick(scripted(0), { a: 1, b: 3 })).toBe("a");
    expect(weightedPick(scripted(0.5), { a: 1, b: 3 })).toBe("b");
    expect(weightedPick(scripted(0.999), { a: 0, b: 1 })).toBe("b");
    expect(weightedPick(scripted(0), { a: 0, b: -1 })).toBeUndefined();
    expect(weightedPick(scripted(0), {})).toBeUndefined();
  });
  it("weightedPick falls back to the last entry on float edge", () => {
    expect(weightedPick({ next: () => 1 }, { a: 1, b: 1 })).toBe("b");
  });
  it("pickOne and shuffled", () => {
    expect(pickOne(scripted(0), [])).toBeUndefined();
    expect(pickOne(scripted(0.99), ["a", "b"])).toBe("b");
    const r = seededRandom(1);
    const s = shuffled(r, [1, 2, 3, 4, 5]);
    expect([...s].sort()).toEqual([1, 2, 3, 4, 5]);
  });
  it("daysBetween", () => {
    expect(daysBetween(T0, days(2.5))).toBeCloseTo(2.5);
  });
});
