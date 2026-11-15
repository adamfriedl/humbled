import { describe, expect, it } from "vitest";
import { parseCommentOutput, parsePostOutput } from "../src/index.ts";
import { cfg } from "./helpers.ts";

const c = cfg().comedy;
const words = (n: number, seed = "word") =>
  Array.from({ length: n }, (_, i) => `${seed}${i}`).join(" ");
const cand = (body: string, extra: Record<string, unknown> = {}) => ({
  body,
  hashtags: ["#Growth"],
  callback_post_id: null,
  ...extra,
});
const parse = (candidates: unknown[], recent: string[] = [], callbacks: string[] = []) =>
  parsePostOutput(
    { candidates },
    { config: c, recentPosts: recent, allowedCallbackIds: new Set(callbacks) },
  );

describe("parsePostOutput", () => {
  it("accepts valid candidates and normalizes hashtags", () => {
    const out = parse([cand(words(80))]);
    expect(out.accepted).toHaveLength(1);
    expect(out.accepted[0]!.hashtags).toEqual(["Growth"]);
  });
  it("rejects per candidate, with reasons", () => {
    const recent = [words(80, "old")];
    const out = parse(
      [
        cand(words(80)),
        { body: 5 },
        cand(words(10)),
        cand(words(80, "old")),
        cand(words(80, "x"), { callback_post_id: "nope" }),
        cand(words(80, "y"), { hashtags: ["a", "b", "c", "d"] }),
      ],
      recent,
    );
    expect(out.accepted).toHaveLength(1);
    expect(out.rejected.map((r) => r.reason)).toEqual([
      "schema",
      "length",
      "repetition",
      "bad_callback",
      "schema",
    ]);
  });
  it("length tolerance allows slight overruns", () => {
    expect(parse([cand(words(200))]).accepted).toHaveLength(1);
    expect(parse([cand(words(230))]).accepted).toHaveLength(0);
    expect(parse([cand(words(32))]).accepted).toHaveLength(1);
  });
  it("rejects candidates that copy a golden example", () => {
    const golden = words(80, "g");
    const out = parsePostOutput(
      { candidates: [cand(golden), cand(words(80, "fresh"))] },
      { config: c, recentPosts: [], allowedCallbackIds: new Set(), referenceTexts: [golden] },
    );
    expect(out.rejected.map((r) => r.reason)).toEqual(["copied_example"]);
    expect(out.accepted).toHaveLength(1);
  });

  it("accepts a known callback id", () => {
    expect(parse([cand(words(60), { callback_post_id: "p9" })], [], ["p9"]).accepted).toHaveLength(
      1,
    );
  });
  it("rejects repeated openings even with low overall overlap", () => {
    const recent = [
      "Humbled to announce that after fourteen months we have something " + words(60, "a"),
    ];
    const out = parse(
      [cand("Humbled to announce that after fourteen months " + words(60, "b"))],
      recent,
    );
    expect(out.rejected[0]?.reason).toBe("repetition");
  });
  it("throws on a malformed envelope", () => {
    expect(() =>
      parsePostOutput({ nope: 1 }, { config: c, recentPosts: [], allowedCallbackIds: new Set() }),
    ).toThrow();
    expect(() => parse([])).toThrow();
  });
});

describe("parseCommentOutput", () => {
  it("accepts in-range comments and drops the rest", () => {
    expect(
      parseCommentOutput({ body: "  Love this, Brad! Though the data suggests otherwise.  " }, c),
    ).toBe("Love this, Brad! Though the data suggests otherwise.");
    expect(parseCommentOutput({ body: "ok" }, c)).toBeUndefined();
    expect(parseCommentOutput({ body: words(60) }, c)).toBeUndefined();
    expect(parseCommentOutput({ text: "x" }, c)).toBeUndefined();
  });
});
