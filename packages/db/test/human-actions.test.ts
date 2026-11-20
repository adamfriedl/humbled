import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { HumanActions } from "../src/human-actions.ts";
import { owners, reactions } from "../src/schema.ts";
import { T0, at, seed, useDb } from "./helpers.ts";

const { h, repos } = useDb();
const human = () => new HumanActions(h().db);
const engagement = {
  reactionWeight: 1,
  commentWeight: 3,
  shareWeight: 5,
  humanReactionWeight: 2,
  cringeBonusPerPoint: 0.25,
  reachHalfLifeHours: 12,
};

async function post() {
  await repos().upsertHouseBots([seed("brock"), seed("priya")]);
  return repos().insertPost({ personaId: "brock", format: "lesson", body: "Read that again." });
}

describe("owners", () => {
  it("are created on first sight and refreshed after", async () => {
    await human().touchOwner("cookie-1", T0);
    await human().touchOwner("cookie-1", at(60));
    const rows = await h().db.select().from(owners);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "cookie-1", createdAt: T0, lastSeenAt: at(60) });
  });
});

describe("reactions", () => {
  it("keep one per post per owner, replacing the kind, and can be removed", async () => {
    const p = await post();
    expect(await human().react(p, "cookie-1", "like", T0)).toBe(true);
    expect(await human().react(p, "cookie-1", "celebrate", at(1))).toBe(true);
    await human().react(p, "cookie-2", "curious", at(2));
    await repos().react(p, "priya", "like"); // a bot's reaction is separate

    const rows = await h().db.select().from(reactions);
    expect(rows).toHaveLength(3);
    expect(await human().reactionsOf("cookie-1", [p])).toEqual(new Map([[p, "celebrate"]]));
    expect(await human().reactionsOf("cookie-1", [])).toEqual(new Map());

    await human().unreact(p, "cookie-1");
    expect(await human().reactionsOf("cookie-1", [p])).toEqual(new Map());
    expect(await h().db.select().from(reactions)).toHaveLength(2);
  });

  it("refuse an unknown post", async () => {
    expect(await human().react("missing", "cookie-1", "like", T0)).toBe(false);
  });
});

describe("rescore", () => {
  it("weights human reactions apart from bot reactions, with the judge's cringe bonus", async () => {
    const p = await post();
    await repos().react(p, "priya", "like"); // bot: 1
    await human().react(p, "cookie-1", "like", T0); // human: 1 × 2
    await repos().insertComment({ postId: p, personaId: "priya", body: "Agree.", depth: 1 }); // 3
    expect(await repos().rescore(p, engagement)).toBe(6);
    await repos().setJudgeScore(p, { funny: 5 }); // 2 points over 3 → ×1.5
    expect(await repos().rescore(p, engagement)).toBe(9);
    expect(await repos().rescore("missing", engagement)).toBeUndefined();
  });
});

describe("rate limits", () => {
  it("allow up to the limit within the window, without counting refusals", async () => {
    const minute = 60_000;
    expect(await human().allow("k", 2, minute, T0)).toBe(true);
    expect(await human().allow("k", 2, minute, at(0.1))).toBe(true);
    expect(await human().allow("k", 2, minute, at(0.2))).toBe(false);
    expect(await human().allow("other", 2, minute, at(0.2))).toBe(true);
    // Once the first two age out of the window, the key is allowed again.
    expect(await human().allow("k", 2, minute, at(1.5))).toBe(true);
  });
});

describe("IP hashing (SR-8)", () => {
  it("is stable within a day, differs across days, and never stores the address", async () => {
    const a = await human().hashIp("203.0.113.7", T0);
    expect(await human().hashIp("203.0.113.7", at(60))).toBe(a);
    expect(await human().hashIp("203.0.113.8", T0)).not.toBe(a);
    expect(await human().hashIp("203.0.113.7", at(24 * 60))).not.toBe(a);
    const dump = JSON.stringify(
      (await h().db.execute(sql`select * from ip_salts, rate_events`)).rows,
    );
    expect(dump).not.toContain("203.0.113.7");
  });

  it("prunes salts after 30 days and rate events after a day", async () => {
    await human().hashIp("203.0.113.7", T0);
    await human().allow("k", 5, 60_000, T0);
    await human().prune(at(2 * 24 * 60));
    expect((await h().db.execute(sql`select count(*)::int n from rate_events`)).rows[0]).toEqual({
      n: 0,
    });
    expect((await h().db.execute(sql`select count(*)::int n from ip_salts`)).rows[0]).toEqual({
      n: 1,
    });
    await human().prune(at(31 * 24 * 60));
    expect((await h().db.execute(sql`select count(*)::int n from ip_salts`)).rows[0]).toEqual({
      n: 0,
    });
  });
});
