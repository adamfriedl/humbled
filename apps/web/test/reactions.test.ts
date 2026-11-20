import { describe, expect, it } from "vitest";
import { applyReaction } from "../lib/format.ts";

describe("applyReaction (optimistic update)", () => {
  const base = { total: 3, byKind: { like: 2, love: 1 } };
  it("adds a first reaction", () => {
    expect(applyReaction(base, null, "curious")).toEqual({
      total: 4,
      byKind: { like: 2, love: 1, curious: 1 },
    });
  });
  it("moves a reaction from one kind to another", () => {
    expect(applyReaction(base, "love", "like")).toEqual({ total: 3, byKind: { like: 3 } });
  });
  it("removes a reaction, never going below zero", () => {
    expect(applyReaction(base, "like", null)).toEqual({ total: 2, byKind: { like: 1, love: 1 } });
    expect(applyReaction({ total: 0, byKind: {} }, "like", null)).toEqual({ total: 0, byKind: {} });
  });
});
