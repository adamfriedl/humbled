import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor, WebQueries } from "../src/web-queries.ts";
import { T0, at, seed, useDb } from "./helpers.ts";

const { h, repos } = useDb();
const web = () => new WebQueries(h().db);

async function world() {
  await repos().upsertHouseBots([
    seed("brock", {
      name: "Brock Halvorsen",
      canon: { employers: ["Bandwidth Partners, SDR", "Grindstone Capital, founder"], facts: [] },
    }),
    seed("priya", { name: "Priya Raman", type: "ai_evangelist" }),
    seed("gary", { name: "Gary Ott", type: "middle_manager" }),
  ]);
}

const post = (personaId: string, minutes: number, body = `post at ${minutes}`) =>
  repos().insertPost({
    personaId,
    format: "lesson",
    body,
    hashtags: ["#Grit"],
    createdAt: at(minutes),
  });

describe("cursor", () => {
  it("round-trips and rejects garbage", () => {
    const c = encodeCursor(T0, "abc");
    expect(decodeCursor(c)).toEqual({ createdAt: T0, id: "abc" });
    expect(decodeCursor("nonsense")).toBeUndefined();
    expect(decodeCursor(Buffer.from("not-a-date|x").toString("base64url"))).toBeUndefined();
  });
});

describe("latest", () => {
  it("pages newest first without skipping or repeating", async () => {
    await world();
    for (let i = 0; i < 5; i++) await post("brock", i);
    const first = await web().latest({ limit: 2 });
    expect(first.posts.map((p) => p.body)).toEqual(["post at 4", "post at 3"]);
    const second = await web().latest({ limit: 2, cursor: first.nextCursor! });
    expect(second.posts.map((p) => p.body)).toEqual(["post at 2", "post at 1"]);
    const third = await web().latest({ limit: 2, cursor: second.nextCursor! });
    expect(third.posts.map((p) => p.body)).toEqual(["post at 0"]);
    expect(third.nextCursor).toBeUndefined();
  });

  it("pages stably through posts with the same timestamp", async () => {
    await world();
    for (let i = 0; i < 4; i++) await post("brock", 0, `same ${i}`);
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await web().latest({ limit: 1, ...(cursor ? { cursor } : {}) });
      seen.push(...page.posts.map((p) => p.body));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen.sort()).toEqual(["same 0", "same 1", "same 2", "same 3"]);
  });

  it("filters by persona, carries the author and counts reactions and comments", async () => {
    await world();
    const id = await post("brock", 1);
    await post("priya", 2);
    await repos().react(id, "priya", "celebrate");
    await repos().react(id, "gary", "celebrate");
    await repos().react(id, "gary", "like"); // second reaction by the same actor is ignored
    await repos().insertComment({
      postId: id,
      personaId: "priya",
      body: "Respectfully.",
      depth: 1,
    });

    const page = await web().latest({ limit: 10, personaId: "brock" });
    expect(page.posts).toHaveLength(1);
    const [p] = page.posts;
    expect(p!.author).toMatchObject({ id: "brock", name: "Brock Halvorsen", type: "hustle_bro" });
    expect(p!.reactions).toEqual({ total: 2, byKind: { celebrate: 2 } });
    expect(p!.commentCount).toBe(1);
    expect(p!.hashtags).toEqual(["#Grit"]);
  });

  it("ignores an invalid cursor", async () => {
    await world();
    await post("brock", 0);
    expect((await web().latest({ limit: 5, cursor: "garbage" })).posts).toHaveLength(1);
  });
});

describe("trending", () => {
  it("ranks recent posts by engagement and pages by offset", async () => {
    await world();
    const old = await post("brock", -9 * 24 * 60, "too old");
    const a = await post("brock", 0, "a");
    const b = await post("priya", 1, "b");
    const c = await post("gary", 2, "c");
    await repos().setEngagementScore(old, 99);
    await repos().setEngagementScore(a, 5);
    await repos().setEngagementScore(b, 9);
    await repos().setEngagementScore(c, 1);

    const opts = { limit: 2, now: at(10), windowDays: 7 };
    const first = await web().trending(opts);
    expect(first.posts.map((p) => p.body)).toEqual(["b", "a"]);
    expect(first.nextCursor).toBe("2");
    const second = await web().trending({ ...opts, cursor: first.nextCursor! });
    expect(second.posts.map((p) => p.body)).toEqual(["c"]);
    expect(second.nextCursor).toBeUndefined();
    expect((await web().trending({ ...opts, cursor: "junk" })).posts[0]!.body).toBe("b");
  });
});

describe("post", () => {
  it("returns the post with its thread oldest first", async () => {
    await world();
    const id = await post("brock", 0);
    const top = await repos().insertComment({
      postId: id,
      personaId: "priya",
      body: "Here's the thing:",
      depth: 1,
      createdAt: at(1),
    });
    await repos().insertComment({
      postId: id,
      parentId: top,
      personaId: "brock",
      body: "Read that again.",
      depth: 2,
      createdAt: at(2),
    });
    const view = await web().post(id);
    expect(view!.post.commentCount).toBe(2);
    expect(view!.comments.map((c) => [c.author.name, c.depth, c.parentId])).toEqual([
      ["Priya Raman", 1, null],
      ["Brock Halvorsen", 2, top],
    ]);
  });

  it("is undefined for an unknown id", async () => {
    expect(await web().post("missing")).toBeUndefined();
  });
});

describe("profile", () => {
  it("gathers follows, endorsements, rivalries, employers and career events", async () => {
    await world();
    await repos().follow("priya", "brock");
    await repos().follow("gary", "brock");
    await repos().follow("brock", "priya");
    await repos().endorse("priya", "brock", "Grit");
    await repos().endorse("gary", "brock", "Grit");
    await repos().endorse("gary", "brock", "Cold plunging");
    const rel = (to: string, affinity: number, stage: "neutral" | "cold" | "comment_war") =>
      repos().saveRelationship({ from: "brock", to, affinity, stage, stageSince: T0, notes: [] });
    await rel("priya", -0.6, "comment_war");
    await rel("gary", -0.2, "cold");
    await repos().seedRelationship({
      from: "priya",
      to: "brock",
      affinity: 0.4,
      stage: "neutral",
      stageSince: T0,
      notes: [],
    });
    await h().db.execute(
      sql`insert into career_events (persona_id, kind, details) values ('brock', 'promotion', '{"title":"CDO"}')`,
    );

    const p = await web().profile("brock", { rivalries: 3 });
    expect(p!.persona).toMatchObject({ id: "brock", origin: "Sold knives at 14." });
    expect(p!.employers).toEqual(["Bandwidth Partners, SDR", "Grindstone Capital, founder"]);
    expect([p!.followers, p!.following]).toEqual([2, 1]);
    expect(p!.endorsements).toEqual([
      { skill: "Grit", count: 2 },
      { skill: "Cold plunging", count: 1 },
    ]);
    expect(p!.rivalries.map((r) => [r.persona.id, r.stage])).toEqual([
      ["priya", "comment_war"],
      ["gary", "cold"],
    ]);
    expect(p!.careerEvents).toEqual([
      expect.objectContaining({ kind: "promotion", details: { title: "CDO" } }),
    ]);

    expect((await web().profile("brock", { rivalries: 1 }))!.rivalries).toHaveLength(1);
  });

  it("handles a persona with no memory or activity, and an unknown id", async () => {
    await world();
    await h().db.execute(sql`delete from persona_memory where persona_id = 'gary'`);
    const p = await web().profile("gary", { rivalries: 3 });
    expect(p).toMatchObject({
      careerSummary: null,
      employers: [],
      followers: 0,
      following: 0,
      endorsements: [],
      rivalries: [],
      careerEvents: [],
    });
    expect(await web().profile("nobody", { rivalries: 3 })).toBeUndefined();
  });
});
