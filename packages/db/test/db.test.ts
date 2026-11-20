import { PERSONA_TYPES, POST_FORMATS, RELATIONSHIP_STAGES } from "@humbled/domain";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { migrate } from "../src/client.ts";
import { owners, personas } from "../src/schema.ts";
import { PgSpendLedger } from "../src/spend-ledger.ts";
import { utcDay, type ActionKey } from "../src/repositories.ts";
import { T0, at, seed, useDb } from "./helpers.ts";

const { h, repos } = useDb();

const usage = { inputTokens: 100, cacheReadTokens: 900, cacheWriteTokens: 0, outputTokens: 50 };
const entry = (estCostUsd: number, when: Date, transport: "batch" | "realtime" = "batch") => ({
  callType: "post" as const,
  model: "claude-haiku-5-5",
  transport,
  usage,
  estCostUsd,
  at: when,
});

describe("migrations", () => {
  it("are idempotent and install pgvector", async () => {
    await migrate(h().db);
    const ext = await h().db.execute(
      sql`select extname from pg_extension where extname = 'vector'`,
    );
    expect(ext.rows).toHaveLength(1);
  });

  it("enums match the domain's constants", async () => {
    const values = async (name: string) =>
      (
        await h().db.execute<{ v: string }>(
          sql`select unnest(enum_range(null::${sql.raw(name)}))::text as v`,
        )
      ).rows.map((r) => r.v);
    expect(await values("persona_type")).toEqual([...PERSONA_TYPES]);
    expect(await values("post_format")).toEqual([...POST_FORMATS]);
    expect(await values("relationship_stage")).toEqual([...RELATIONSHIP_STAGES]);
  });
});

describe("PgSpendLedger (CR-7)", () => {
  it("sums one UTC day per transport", async () => {
    const ledger = new PgSpendLedger(h().db);
    await ledger.record(entry(0.01, new Date("2026-11-16T00:00:00.000Z")));
    await ledger.record(entry(0.02, new Date("2026-11-16T23:59:59.999Z")));
    await ledger.record(entry(0.5, new Date("2026-11-17T00:00:00.000Z")));
    await ledger.record(entry(0.25, new Date("2026-11-16T10:00:00.000Z"), "realtime"));
    expect(await ledger.spentOn("2026-11-16", "batch")).toBeCloseTo(0.03, 10);
    expect(await ledger.spentOn("2026-11-16", "realtime")).toBeCloseTo(0.25, 10);
    expect(await ledger.spentOn("2026-11-17", "batch")).toBeCloseTo(0.5, 10);
    expect(await ledger.spentOn("2026-11-18", "batch")).toBe(0);
  });

  it("rejects a malformed day", async () => {
    await expect(new PgSpendLedger(h().db).spentOn("yesterday", "batch")).rejects.toThrow(
      /UTC day/,
    );
  });
});

describe("personas", () => {
  it("upserts house bots from content without losing their career summary", async () => {
    await repos().upsertHouseBots([seed("brock"), seed("kayleigh", { type: "recruiter" })]);
    await repos().setCareerSummary("brock", "Closed two deals before sunrise.");
    await repos().upsertHouseBots([seed("brock", { title: "Chief Discipline Officer" })]);
    const ps = await repos().listPersonas();
    expect(ps.map((p) => p.id)).toEqual(["brock", "kayleigh"]);
    const brock = ps.find((p) => p.id === "brock")!;
    expect(brock).toMatchObject({
      title: "Chief Discipline Officer",
      isHouse: true,
      careerSummary: "Closed two deals before sunrise.",
      ownerLastSeenAt: null,
    });
    expect(brock.canon).toEqual({ facts: ["Owns two cold plunges"] });
    await repos().upsertHouseBots([]);
  });

  it("reports the owner's last visit for user personas (dormancy input)", async () => {
    const seen = new Date("2026-11-10T08:00:00.000Z");
    await h().db.insert(owners).values({ id: "cookie-1", lastSeenAt: seen });
    await h().db.insert(personas).values({
      id: "user-1",
      ownerId: "cookie-1",
      type: "thought_leader",
      name: "Pat",
      title: "Leader",
      company: "Northstar",
      origin: "x",
    });
    const [p] = await repos().listPersonas();
    expect(p).toMatchObject({ isHouse: false, ownerLastSeenAt: seen, canon: {} });
  });
});

describe("relationships", () => {
  it("seeds without overwriting history, then saves stage changes", async () => {
    await repos().upsertHouseBots([seed("a"), seed("b")]);
    const r = {
      from: "a",
      to: "b",
      affinity: -0.5,
      stage: "cold" as const,
      stageSince: T0,
      notes: [],
    };
    await repos().seedRelationship(r);
    await repos().saveRelationship(
      { ...r, stage: "comment_war", affinity: -0.7, notes: ["he liked Greg's post"] },
      at(5),
    );
    await repos().seedRelationship(r); // a redeploy re-seeding content must not reset the feud
    expect(await repos().relationshipsFrom("a")).toEqual([
      {
        ...r,
        stage: "comment_war",
        affinity: expect.closeTo(-0.7, 5),
        notes: ["he liked Greg's post"],
      },
    ]);
    expect(await repos().relationshipsFrom("b")).toEqual([]);
  });
});

describe("feed", () => {
  it("serves the feed window, recent posts, counts and lookups", async () => {
    await repos().upsertHouseBots([seed("a"), seed("b")]);
    const old = await repos().insertPost({
      personaId: "a",
      format: "lesson",
      body: "old",
      createdAt: at(-3000),
    });
    const p1 = await repos().insertPost({
      personaId: "a",
      format: "humblebrag",
      body: "Humbled.",
      hashtags: ["#Grateful"],
      createdAt: at(1),
    });
    const p2 = await repos().insertPost({
      personaId: "b",
      format: "lesson",
      body: "4:12am.",
      createdAt: at(2),
    });
    const feed = await repos().feedSince(at(-60));
    expect(feed.map((f) => f.postId)).toEqual([p2, p1]);
    expect(feed[0]).toMatchObject({ authorId: "b", engagementScore: 0 });

    await repos().setEngagementScore(p1, 12.5);
    await repos().setJudgeScore(p1, { funny: 4 });
    const [row] = await repos().postsById([p1]);
    expect(row).toMatchObject({
      engagementScore: 12.5,
      judgeScore: { funny: 4 },
      hashtags: ["#Grateful"],
    });
    expect(await repos().postsById([])).toEqual([]);
    expect((await repos().recentPostsBy("a", 1)).map((p) => p.id)).toEqual([p1]);
    expect((await repos().recentPostsBy("a", 5)).map((p) => p.id)).toEqual([p1, old]);

    await repos().insertComment({
      postId: p2,
      personaId: "a",
      body: "Read that again.",
      depth: 1,
      createdAt: at(3),
    });
    expect(await repos().dailyCounts("a", T0)).toEqual({ posts: 1, comments: 1, nudges: 0 });
    expect(await repos().dailyCounts("b", T0)).toEqual({ posts: 1, comments: 0, nudges: 0 });
  });

  it("finds reply candidates and posts already commented on", async () => {
    await repos().upsertHouseBots([seed("a"), seed("b"), seed("c")]);
    const pa = await repos().insertPost({
      personaId: "a",
      format: "lesson",
      body: "x",
      createdAt: at(0),
    });
    const pb = await repos().insertPost({
      personaId: "b",
      format: "lesson",
      body: "y",
      createdAt: at(0),
    });
    // b comments on a's post; a replies to b; c replies to a's reply.
    const cb = await repos().insertComment({
      postId: pa,
      personaId: "b",
      body: "Love this",
      depth: 1,
      createdAt: at(1),
    });
    const ra = await repos().insertComment({
      postId: pa,
      parentId: cb,
      personaId: "a",
      body: "Thanks",
      depth: 2,
      createdAt: at(2),
    });
    const rc = await repos().insertComment({
      postId: pa,
      parentId: ra,
      personaId: "c",
      body: "Agree",
      depth: 3,
      createdAt: at(3),
    });
    // a comments top-level on b's post.
    await repos().insertComment({
      postId: pb,
      personaId: "a",
      body: "Respectfully",
      depth: 1,
      createdAt: at(4),
    });

    // b's comment is excluded: a already replied to it (ra).
    const forA = await repos().replyCandidates("a", at(-10));
    expect(forA).toEqual([
      { commentId: rc, postId: pa, authorId: "c", depth: 3, parentAuthorId: "a" },
    ]);
    expect(await repos().replyCandidates("a", at(10))).toEqual([]);
    expect(await repos().commentedPostIds("a", at(-10))).toEqual(new Set([pb]));
    expect(await repos().commentedPostIds("c", at(-10))).toEqual(new Set());
    expect((await repos().commentsById([ra])).map((c) => c.parentId)).toEqual([cb]);
    expect(await repos().commentsById([])).toEqual([]);
  });
});

describe("code-only actions", () => {
  it("are idempotent", async () => {
    await repos().upsertHouseBots([seed("a"), seed("b")]);
    const p = await repos().insertPost({ personaId: "b", format: "lesson", body: "x" });
    expect(await repos().react(p, "a", "insightful", at(1))).toBe(true);
    expect(await repos().react(p, "a", "celebrate")).toBe(false);
    expect(await repos().reactionCounts([p])).toEqual(new Map([[p, 1]]));
    expect(await repos().reactionCounts([])).toEqual(new Map());
    expect(await repos().follow("a", "b")).toBe(true);
    expect(await repos().follow("a", "b")).toBe(false);
    expect(await repos().following("a")).toEqual(new Set(["b"]));
    expect(await repos().endorse("a", "b", "Discipline")).toBe(true);
    expect(await repos().endorse("a", "b", "Discipline")).toBe(false);
    expect(await repos().endorse("a", "b", "Cold Exposure")).toBe(true);
    expect(await repos().endorsed("a")).toEqual(new Set(["b"]));
  });
});

describe("actions (idempotency)", () => {
  it("a redelivered tick can't claim the same action twice", async () => {
    await repos().upsertHouseBots([seed("a")]);
    const key: ActionKey = { tickId: "2026-11-16T12:00Z", personaId: "a", actionType: "post" };
    const plan = { kind: "post" as const, personaId: "a", format: "lesson" as const };
    expect(await repos().claimAction(key, plan)).toBe(true);
    expect(await repos().claimAction(key, plan)).toBe(false);
    expect(await repos().claimAction({ ...key, actionType: "react" }, plan)).toBe(true);

    await repos().attachBatch([key], "batch-1");
    expect(await repos().getAction(key)).toMatchObject({
      status: "pending",
      batchId: "batch-1",
      plan,
    });
    await repos().finishAction(key, "done");
    expect((await repos().getAction(key))?.status).toBe("done");
  });
});

describe("llm batches", () => {
  it("can be collected only once", async () => {
    const id = await repos().createBatch("msgbatch_1", "tick", { r1: { kind: "post" } });
    const other = await repos().createBatch("msgbatch_2", "nightly", {});
    expect((await repos().openBatches()).map((b) => b.id)).toEqual([id, other]);
    expect(await repos().markBatch(id, "collected", at(5))).toBe(true);
    expect(await repos().markBatch(id, "collected", at(6))).toBe(false);
    expect(await repos().markBatch(other, "failed", at(6))).toBe(true);
    expect(await repos().openBatches()).toEqual([]);
  });
});

describe("world events", () => {
  const events = [
    { id: "launch", headline: "Pods cracked down on", body: "Everyone affected." },
    { id: "layoffs", headline: "Quick sync layoffs", body: "Attendance 96%." },
  ];

  it("publishes in content order, once per day, until they run out", async () => {
    await repos().syncWorldEvents(events);
    const order = events.map((e) => e.id);
    expect((await repos().publishEvent("2026-11-16", order))?.id).toBe("launch");
    expect((await repos().publishEvent("2026-11-16", order))?.id).toBe("launch");
    expect((await repos().publishEvent("2026-11-17", order))?.id).toBe("layoffs");
    expect(await repos().publishEvent("2026-11-18", order)).toBeUndefined();
    expect((await repos().eventOn("2026-11-17"))?.headline).toBe("Quick sync layoffs");

    // Re-syncing content edits the text but keeps the published dates.
    await repos().syncWorldEvents([{ ...events[0]!, headline: "Pods suppressed" }]);
    expect(await repos().eventOn("2026-11-16")).toMatchObject({
      id: "launch",
      headline: "Pods suppressed",
    });
  });
});

describe("utcDay", () => {
  it("bounds the UTC calendar day", () => {
    expect(utcDay(new Date("2026-11-16T23:59:59.999Z"))).toEqual({
      start: new Date("2026-11-16T00:00:00.000Z"),
      end: new Date("2026-11-17T00:00:00.000Z"),
    });
  });
});

describe("worker state", () => {
  it("keeps owed ladder posts and relationship backstory", async () => {
    await repos().upsertHouseBots([seed("a"), seed("b")]);
    await repos().setPendingPosts("a", [{ format: "public_exit", targetId: "b" }]);
    expect((await repos().listPersonas())[0]?.pendingPosts).toEqual([
      { format: "public_exit", targetId: "b" },
    ]);
    await repos().setPendingPosts("a", []);
    expect((await repos().listPersonas())[0]?.pendingPosts).toEqual([]);

    const r = {
      from: "a",
      to: "b",
      affinity: -0.4,
      stage: "cold" as const,
      stageSince: T0,
      notes: [],
    };
    await repos().seedRelationship(r, "Both claimed the same deal in Q3.");
    await repos().seedRelationship({ ...r, from: "b", to: "a" });
    const all = await repos().allRelationships();
    expect(all.find((x) => x.rel.from === "a")).toEqual({
      rel: { ...r, affinity: expect.closeTo(-0.4, 5) },
      history: "Both claimed the same deal in Q3.",
    });
    expect(all.find((x) => x.rel.from === "b")?.history).toBeNull();
  });

  it("skips comments already replied to, and tracks the reply cooldown", async () => {
    await repos().upsertHouseBots([seed("a"), seed("b")]);
    const pa = await repos().insertPost({
      personaId: "a",
      format: "lesson",
      body: "x",
      createdAt: at(0),
    });
    const cb = await repos().insertComment({
      postId: pa,
      personaId: "b",
      body: "Love this",
      depth: 1,
      createdAt: at(1),
    });
    expect((await repos().replyCandidates("a", at(-10))).map((c) => c.commentId)).toEqual([cb]);
    expect(await repos().lastRepliedAt("a")).toEqual(new Map());

    await repos().insertComment({
      postId: pa,
      parentId: cb,
      personaId: "a",
      body: "Thanks",
      depth: 2,
      createdAt: at(2),
    });
    expect(await repos().replyCandidates("a", at(-10))).toEqual([]);
    expect(await repos().lastRepliedAt("a")).toEqual(new Map([["b", at(2)]]));
  });

  it("knows whether a persona already posted a format today", async () => {
    await repos().upsertHouseBots([seed("a")]);
    expect(await repos().postedFormatOn("a", "event_reaction", T0)).toBe(false);
    await repos().insertPost({
      personaId: "a",
      format: "event_reaction",
      body: "x",
      createdAt: at(-60),
    });
    expect(await repos().postedFormatOn("a", "event_reaction", T0)).toBe(true);
    expect(await repos().postedFormatOn("a", "event_reaction", at(24 * 60))).toBe(false);
  });
});

describe("job runs and comment counts", () => {
  it("claims a job run once", async () => {
    expect(await repos().claimJobRun("nightly", "2026-11-16")).toBe(true);
    expect(await repos().claimJobRun("nightly", "2026-11-16")).toBe(false);
    expect(await repos().claimJobRun("nightly", "2026-11-17")).toBe(true);
  });

  it("counts comments per post", async () => {
    await repos().upsertHouseBots([seed("a"), seed("b")]);
    const p = await repos().insertPost({ personaId: "a", format: "lesson", body: "x" });
    const c = await repos().insertComment({ postId: p, personaId: "b", body: "y", depth: 1 });
    await repos().insertComment({ postId: p, parentId: c, personaId: "a", body: "z", depth: 2 });
    expect(await repos().commentCounts([p])).toEqual(new Map([[p, 2]]));
    expect(await repos().commentCounts([])).toEqual(new Map());
  });
});

describe("releasing claims", () => {
  it("releases a job run and unbatched actions, keeping batched ones", async () => {
    await repos().upsertHouseBots([seed("a")]);
    expect(await repos().claimJobRun("tick", "t1")).toBe(true);
    await repos().releaseJobRun("tick", "t1");
    expect(await repos().claimJobRun("tick", "t1")).toBe(true);

    const plan = { kind: "post" as const, personaId: "a", format: "lesson" as const };
    const post: ActionKey = { tickId: "t1", personaId: "a", actionType: "post" };
    const comment: ActionKey = { ...post, actionType: "comment" };
    await repos().claimAction(post, plan);
    await repos().claimAction(comment, plan);
    await repos().attachBatch([post], "b1");
    await repos().releaseActions([post, comment]);
    expect(await repos().getAction(post)).toBeDefined();
    expect(await repos().getAction(comment)).toBeUndefined();
    expect(await repos().claimAction(comment, plan)).toBe(true);
  });
});

describe("deferred follow-ups", () => {
  it("are taken once, oldest first", async () => {
    await repos().deferFollowUps([]); // nothing to keep
    await repos().deferFollowUps([{ n: 1 }, { n: 2 }]);
    await repos().deferFollowUps([{ n: 3 }]);
    expect(await repos().takeDeferredFollowUps()).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
    expect(await repos().takeDeferredFollowUps()).toEqual([]);
  });
});
