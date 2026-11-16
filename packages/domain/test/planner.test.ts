import { describe, expect, it } from "vitest";
import { planTick, seededRandom, type PlannedAction } from "../src/index.ts";
import { T0, always, cfg, never, planInput, scripted } from "./helpers.ts";
import { newRelationship } from "../src/grudge.ts";

const c = cfg();
const kinds = (as: PlannedAction[]) => as.map((a) => a.kind);

describe("planTick", () => {
  it("plans nothing when activity is zero (fully dormant)", () => {
    expect(planTick(planInput({ activityMultiplier: 0 }), always, c)).toEqual([]);
  });

  it("plans nothing when every roll fails", () => {
    expect(planTick(planInput(), never, c)).toEqual([]);
  });

  it("plans every action kind when every roll succeeds", () => {
    const input = planInput({
      replyCandidates: [{ commentId: "c1", postId: "p2", authorId: "brad", depth: 1 }],
      following: new Set(["chad"]),
    });
    const as = planTick(input, always, c);
    expect(kinds(as)).toEqual(["post", "comment", "reply", "react", "follow", "endorse"]);
    // Never targets own posts.
    for (const a of as) if ("postId" in a && a.kind !== "reply") expect(a.postId).toBe("p1");
    expect(as.find((a) => a.kind === "reply")).toMatchObject({ parentAuthorId: "brad", depth: 2 });
    expect(as.find((a) => a.kind === "follow")).toMatchObject({ targetId: "brad" });
    expect(as.find((a) => a.kind === "endorse")).toMatchObject({ targetId: "chad" });
  });

  it("only code-only actions when generation is paused by budget", () => {
    const as = planTick(planInput({ generationAllowed: false }), always, c);
    expect(kinds(as)).toEqual(["react", "follow"]);
  });

  it("respects post and comment quotas", () => {
    const as = planTick(planInput({ counts: { posts: 4, comments: 15, nudges: 0 } }), always, c);
    expect(kinds(as)).not.toContain("post");
    expect(kinds(as)).not.toContain("comment");
    expect(kinds(as)).not.toContain("reply");
  });

  it("a planned comment counts toward the quota before a reply", () => {
    const input = planInput({
      counts: { posts: 0, comments: 14, nudges: 0 },
      replyCandidates: [{ commentId: "c1", postId: "p2", authorId: "brad", depth: 1 }],
    });
    const ks = kinds(planTick(input, always, c));
    expect(ks).toContain("comment");
    expect(ks).not.toContain("reply");
  });

  it("reply candidates respect depth, cooldown and self", () => {
    const input = planInput({
      replyCandidates: [
        { commentId: "deep", postId: "p2", authorId: "brad", depth: 3 },
        { commentId: "self", postId: "p2", authorId: "me", depth: 1 },
        { commentId: "cool", postId: "p2", authorId: "chad", depth: 1 },
      ],
      lastRepliedAt: new Map([["chad", T0]]),
    });
    expect(kinds(planTick(input, always, c))).not.toContain("reply");
  });

  it("event day: posts an event reaction until the persona has reacted", () => {
    const input = planInput({ worldEvent: { id: "ev1", alreadyReacted: false } });
    expect(planTick(input, always, c)[0]).toMatchObject({
      kind: "post",
      format: "event_reaction",
      worldEventId: "ev1",
    });
    const after = planInput({ worldEvent: { id: "ev1", alreadyReacted: true } });
    expect(planTick(after, always, c)[0]).toMatchObject({ kind: "post", format: "lesson" });
  });

  it("vague-posts about a stage-2 rival", () => {
    const rel = { ...newRelationship("me", "brad", T0, -0.5), stage: "vague_posting" as const };
    const input = planInput({ relationships: [rel] });
    expect(planTick(input, always, c)[0]).toMatchObject({
      format: "vague_post",
      grudgeTargetId: "brad",
    });
    // No back-to-back vague posts: falls through to a normal format with grudge callback.
    const again = planInput({ relationships: [rel], recentFormats: ["vague_post"] });
    expect(planTick(again, always, c)[0]).toMatchObject({
      format: "lesson",
      grudgeTargetId: "brad",
    });
  });

  it("feuding personas stop reacting to and following their rival, and comment-war on their posts", () => {
    const war = { ...newRelationship("me", "brad", T0, -0.7), stage: "comment_war" as const };
    const as = planTick(planInput({ relationships: [war] }), always, c);
    expect(as.find((a) => a.kind === "comment")).toMatchObject({
      postAuthorId: "brad",
      grudge: true,
    });
    expect(kinds(as)).not.toContain("react");
    expect(kinds(as)).not.toContain("follow");
  });

  it("cold rivals get neither comments nor reactions", () => {
    const cold = { ...newRelationship("me", "brad", T0, -0.3), stage: "cold" as const };
    const ks = kinds(planTick(planInput({ relationships: [cold] }), always, c));
    expect(ks).not.toContain("comment");
    expect(ks).not.toContain("react");
  });

  it("leaves one top-level comment per post, but can still react to it", () => {
    const before = planTick(planInput(), always, c);
    expect(before.find((a) => a.kind === "comment")).toMatchObject({ postId: "p1" });
    const after = planTick(planInput({ commentedPostIds: new Set(["p1"]) }), always, c);
    expect(kinds(after)).not.toContain("comment");
    expect(after.find((a) => a.kind === "react")).toMatchObject({ postId: "p1" });
  });

  it("comments on a fresh post when it has already commented on others", () => {
    const feed = [
      { postId: "p1", authorId: "brad", engagementScore: 10, createdAt: T0 },
      { postId: "p3", authorId: "kim", engagementScore: 10, createdAt: T0 },
    ];
    const as = planTick(planInput({ feed, commentedPostIds: new Set(["p1"]) }), always, c);
    expect(as.find((a) => a.kind === "comment")).toMatchObject({ postId: "p3" });
  });

  it("skips a post when the type has no eligible formats", () => {
    const input = planInput({
      profile: { ...planInput().profile, formatWeights: { milestone: 1 } },
    });
    expect(kinds(planTick(input, always, c))).not.toContain("post");
  });

  it("frequency setting scales activity", () => {
    const r = scripted(0.3); // passes 0.5*1, fails 0.5*0.5
    expect(kinds(planTick(planInput(), r, c))[0]).toBe("post");
    const low = planInput({ persona: { ...planInput().persona, frequency: "low" } });
    expect(kinds(planTick(low, scripted(0.3), c))).not.toContain("post");
  });

  it("is deterministic for a given seed", () => {
    const run = () => {
      const r = seededRandom(123);
      return Array.from({ length: 50 }, () => planTick(planInput(), r, c));
    };
    expect(run()).toEqual(run());
  });
});
