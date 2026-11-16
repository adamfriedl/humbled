import type { BuiltPrompt } from "@humbled/comedy";
import { describe, expect, it } from "vitest";
import { fakeResponder } from "../src/index.ts";

const prompt = (kind: BuiltPrompt["kind"], user: string): BuiltPrompt => ({
  kind,
  system: [
    { text: "style", cache: true },
    { text: "type", cache: true },
    { text: '{ "name": "Brock Halvorsen" }', cache: true },
  ],
  user,
  maxTokens: 100,
  outputSchema: {},
  estimatedInputTokens: 10,
  trimmed: [],
});
const call = (kind: BuiltPrompt["kind"], user: string) =>
  fakeResponder({
    id: "r1",
    callType: kind === "post" ? "post" : kind,
    prompt: prompt(kind, user),
  });

describe("fakeResponder", () => {
  it("returns the requested number of labeled post candidates", () => {
    const out = call("post", 'Write 3 different takes in the format "lesson".') as {
      candidates: { body: string; hashtags: string[]; callback_post_id: null }[];
    };
    expect(out.candidates).toHaveLength(3);
    expect(out.candidates[0]!.body).toContain("[FAKE lesson #1 by Brock Halvorsen]");
    expect(out.candidates[0]).toMatchObject({ hashtags: ["Fake"], callback_post_id: null });
  });

  it("scores every judge candidate as safe", () => {
    const out = call(
      "judge",
      '<candidate index="0">a</candidate><candidate index="1">b</candidate>',
    ) as {
      scores: { index: number; safe: number }[];
    };
    expect(out.scores.map((s) => [s.index, s.safe])).toEqual([
      [0, 5],
      [1, 5],
    ]);
  });

  it("writes summaries and comments, and defaults the count and name", () => {
    expect((call("summary", "") as { summary: string }).summary).toContain("[FAKE summary");
    expect((call("comment", "") as { body: string }).body).toContain("[FAKE comment by Brock");
    const bare = fakeResponder({
      id: "r2",
      callType: "post",
      prompt: { ...prompt("post", ""), system: [] },
    }) as { candidates: { body: string }[] };
    expect(bare.candidates).toHaveLength(1);
    expect(bare.candidates[0]!.body).toContain("[FAKE post #1 by someone]");
  });
});
