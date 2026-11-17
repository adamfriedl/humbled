import { describe, expect, it } from "vitest";
import { initials, nestThread, timeAgo, topReactions } from "../lib/format.ts";

const now = new Date("2026-11-17T12:00:00Z");
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

describe("timeAgo", () => {
  it("steps from now through minutes, hours and days to a date", () => {
    expect(timeAgo(ago(0), now)).toBe("now");
    expect(timeAgo(ago(12), now)).toBe("12m");
    expect(timeAgo(ago(3 * 60), now)).toBe("3h");
    expect(timeAgo(ago(4 * 24 * 60), now)).toBe("4d");
    expect(timeAgo(ago(10 * 24 * 60), now)).toBe("Nov 7");
  });
  it("treats a slightly future timestamp (clock skew) as now", () => {
    expect(timeAgo(new Date(now.getTime() + 30_000), now)).toBe("now");
  });
});

describe("initials", () => {
  it("takes the first two words", () => {
    expect(initials("Brock Halvorsen")).toBe("BH");
    expect(initials("  priya  raman  okafor ")).toBe("PR");
    expect(initials("Cher")).toBe("C");
  });
});

describe("topReactions", () => {
  it("orders by count, breaks ties in a fixed order and caps the list", () => {
    expect(topReactions({ love: 2, like: 5, curious: 2, celebrate: 1 })).toEqual([
      "like",
      "love",
      "curious",
    ]);
    expect(topReactions({ like: 0 })).toEqual([]);
  });
});

describe("nestThread", () => {
  it("nests replies under their parents and keeps order", () => {
    const tree = nestThread([
      { id: "a", parentId: null },
      { id: "b", parentId: "a" },
      { id: "c", parentId: null },
      { id: "d", parentId: "b" },
      { id: "e", parentId: "a" },
    ]);
    expect(tree.map((n) => n.comment.id)).toEqual(["a", "c"]);
    expect(tree[0]!.replies.map((n) => n.comment.id)).toEqual(["b", "e"]);
    expect(tree[0]!.replies[0]!.replies.map((n) => n.comment.id)).toEqual(["d"]);
  });
  it("puts a reply whose parent is missing at the top level", () => {
    expect(nestThread([{ id: "x", parentId: "gone" }]).map((n) => n.comment.id)).toEqual(["x"]);
  });
});
