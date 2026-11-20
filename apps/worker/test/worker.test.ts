import type { AddressInfo } from "node:net";
import { comments, deferredFollowUps, llmBatches, posts, spendLedger } from "@humbled/db";
import { MS_PER_DAY, MS_PER_MINUTE } from "@humbled/domain";
import { fakeResponder } from "@humbled/llm";
import { count, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { runCollect } from "../src/collect.ts";
import { jsonLogger, personaCard } from "../src/deps.ts";
import { runEvent } from "../src/event.ts";
import { runNightly } from "../src/nightly.ts";
import { eventOrder, relationshipSides } from "../src/seed.ts";
import { createWorkerServer, messageTime } from "../src/server.ts";
import { runTick, seedFor, tickStart } from "../src/tick.ts";
import { T0, content, db, worker, type TestWorker } from "./helpers.ts";

const tickAt = (i: number) => new Date(T0.getTime() + i * 15 * MS_PER_MINUTE);
const rows = async (table: typeof posts | typeof comments) =>
  (await db().select({ n: count() }).from(table))[0]!.n;

/** n ticks, each followed by the two /collect rounds a post needs (generation, then judge). */
async function runTicks(w: TestWorker, n: number, from = 0) {
  for (let i = from; i < from + n; i++) {
    w.clock.set(tickAt(i));
    await runTick(w, tickAt(i));
    await runCollect(w);
    await runCollect(w);
  }
}

describe("tick → collect → judge → collect", () => {
  it("writes judged posts, comments and reactions, and records batch spend", async () => {
    const w = await worker();
    await runEvent(w, T0);
    await runTicks(w, 8);

    const written = await db().select().from(posts);
    expect(written.length).toBeGreaterThan(0);
    // Every post went through the judge round and keeps its winner's scores.
    for (const p of written) {
      expect(p.judgeScore).toMatchObject({ safe: 5 });
      expect(p.body).toContain("[FAKE");
    }
    expect(await rows(comments)).toBeGreaterThan(0);
    const spend = await db().select().from(spendLedger);
    expect(spend.length).toBeGreaterThan(0);
    expect(spend.every((s) => s.transport === "batch")).toBe(true);
    expect(new Set(spend.map((s) => s.callType))).toEqual(new Set(["post", "judge", "comment"]));
    // Every batch submitted was collected.
    expect(await w.repos.openBatches()).toEqual([]);
    expect(w.logs.filter((l) => l.event === "tick")).toHaveLength(8);
  });

  it("leaves one top-level comment per persona per post", async () => {
    const w = await worker();
    await runTicks(w, 12);
    const top = (await db().select().from(comments)).filter((c) => c.parentId === null);
    const keys = top.map((c) => `${c.postId}/${c.personaId}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(top.every((c) => c.depth === 1)).toBe(true);
  });
});

describe("idempotency (Pub/Sub at-least-once)", () => {
  it("a replayed tick message is a no-op", async () => {
    const w = await worker();
    const first = await runTick(w, T0);
    expect(first.claimed).toBeGreaterThan(0);
    expect(first.submitted).toBeGreaterThan(0);
    const replay = await runTick(w, new Date(T0.getTime() + 90_000)); // same 15-minute tick
    expect(replay).toMatchObject({ tickId: first.tickId, skipped: "already_ran", claimed: 0 });
    expect((await db().select().from(llmBatches)).length).toBe(1);
  });

  it("a tick whose batch submit failed can be retried", async () => {
    const w = await worker();
    const submit = w.llm.submitBatch.bind(w.llm);
    w.llm.submitBatch = () => Promise.reject(new Error("anthropic down"));
    await expect(runTick(w, T0)).rejects.toThrow("anthropic down");
    expect(await db().select().from(llmBatches)).toEqual([]);
    w.llm.submitBatch = submit;
    const retry = await runTick(w, T0);
    expect(retry.skipped).toBeUndefined();
    expect(retry.submitted).toBeGreaterThan(0);
    expect((await db().select().from(llmBatches)).length).toBe(1);
  });

  it("a batch is collected once, even if /collect runs again", async () => {
    const w = await worker();
    await runTick(w, T0);
    const once = await runCollect(w);
    expect(once.batchesCollected).toBe(1);
    const followUp = once.followUpBatchId;
    expect(followUp).toBeDefined();
    const again = await runCollect(w);
    expect(again.batchesCollected).toBe(1); // only the judge round
    expect((await runCollect(w)).batchesCollected).toBe(0);
  });

  it("a batch whose results can't be fetched stays open for the next run", async () => {
    const w = await worker();
    await runTick(w, T0);
    const fetch = w.llm.batchResults.bind(w.llm);
    w.llm.batchResults = () => Promise.reject(new Error("500 api_error"));
    await expect(runCollect(w)).rejects.toThrow("500 api_error");
    const [batch] = await db().select().from(llmBatches);
    expect(batch!.status).toBe("submitted"); // not claimed, so nothing is lost
    w.llm.batchResults = fetch;
    expect((await runCollect(w)).batchesCollected).toBe(1);
  });

  it("follow-ups survive a failed submission and go out on the next run", async () => {
    const w = await worker();
    await runTick(w, T0);
    const submit = w.llm.submitBatch.bind(w.llm);
    w.llm.submitBatch = () => Promise.reject(new Error("500 api_error"));
    await expect(runCollect(w)).rejects.toThrow("500 api_error");
    expect(await db().select().from(deferredFollowUps)).toHaveLength(1);
    expect(w.logs.some((l) => l.event === "follow_ups_deferred")).toBe(true);

    w.llm.submitBatch = submit;
    const retry = await runCollect(w);
    expect(retry.batchesCollected).toBe(0); // the tick batch was already written
    expect(retry.followUpBatchId).toBeDefined();
    expect(await db().select().from(deferredFollowUps)).toEqual([]);
    // The judge round they started still produces the posts.
    expect((await runCollect(w)).posts).toBeGreaterThan(0);
  });

  it("keeps earlier batches' follow-ups when a later batch fails", async () => {
    const w = await worker();
    // Tick until two batches are open (the seeded planner doesn't generate on every tick).
    for (let i = 0; (await db().select().from(llmBatches)).length < 2 && i < 12; i++) {
      w.clock.set(tickAt(i));
      await runTick(w, tickAt(i));
    }
    const fetch = w.llm.batchResults.bind(w.llm);
    let calls = 0;
    w.llm.batchResults = (id) =>
      ++calls === 2 ? Promise.reject(new Error("500 api_error")) : fetch(id);
    await expect(runCollect(w)).rejects.toThrow("500 api_error");
    const statuses = (await db().select().from(llmBatches)).map((b) => b.status).sort();
    expect(statuses).toEqual(["collected", "submitted"]);
    expect(await db().select().from(deferredFollowUps)).toHaveLength(1);

    w.llm.batchResults = fetch;
    const retry = await runCollect(w);
    expect(retry.batchesCollected).toBe(1);
    expect(retry.followUpBatchId).toBeDefined();
    expect(await db().select().from(deferredFollowUps)).toEqual([]);
  });

  it("nightly runs once per day", async () => {
    const w = await worker();
    await runTicks(w, 4);
    const night = new Date(
      T0.getTime() + MS_PER_DAY - 9 * 60 * MS_PER_MINUTE + 11 * 60 * MS_PER_MINUTE,
    );
    const first = await runNightly(w, night);
    expect(first.day).toBe("2026-11-16");
    expect(first.summariesSubmitted).toBeGreaterThan(0);
    expect(await runNightly(w, night)).toMatchObject({ skipped: "already_ran" });
    const collected = await runCollect(w);
    expect(collected.summaries).toBe(first.summariesSubmitted);
    const withSummary = (await w.repos.listPersonas()).filter((p) => p.careerSummary);
    expect(withSummary.length).toBe(first.summariesSubmitted);
  });

  it("publishes one event per day", async () => {
    const w = await worker();
    const order = eventOrder(content);
    expect(order[0]).toBe(content.events.find((e) => e.launch)!.id);
    expect((await runEvent(w, T0)).eventId).toBe(order[0]);
    expect((await runEvent(w, T0)).eventId).toBe(order[0]);
    expect((await runEvent(w, new Date(T0.getTime() + MS_PER_DAY))).eventId).toBe(order[1]);
  });
});

describe("CR-7 budget", () => {
  it("pauses generation once the daily budget is spent; code-only actions continue", async () => {
    const w = await worker({ config: { budget: { dailyLlmBudgetUsd: 0.01 } } });
    await w.ledger.record({
      callType: "post",
      model: "claude-haiku-5-5",
      transport: "batch",
      usage: { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
      estCostUsd: 0.02,
      at: T0,
    });
    // Seed a post so there's something to react to.
    await w.repos.insertPost({
      personaId: content.houseBots[0]!.id,
      format: "lesson",
      body: "x",
      createdAt: T0,
    });
    let codeOnly = 0;
    for (let i = 0; i < 6; i++) {
      const r = await runTick(w, tickAt(i));
      expect(r).toMatchObject({ mode: "generation_paused", submitted: 0 });
      codeOnly += r.codeOnly;
    }
    expect(codeOnly).toBeGreaterThan(0);
    expect(await db().select().from(llmBatches)).toEqual([]);
  });
});

describe("retries", () => {
  it("retries a failed request once, then drops it", async () => {
    let failures = 0;
    const w = await worker({
      responder: (req) => {
        if (req.callType === "comment") {
          failures++;
          throw new Error("model unavailable");
        }
        return fakeResponder(req);
      },
    });
    // Something to comment on before any generated post exists.
    for (const b of content.houseBots.slice(0, 3)) {
      await w.repos.insertPost({ personaId: b.id, format: "lesson", body: "x", createdAt: T0 });
    }
    for (let i = 0; i < 8 && failures === 0; i++) await runTick(w, tickAt(i));
    expect(failures).toBeGreaterThan(0);
    const first = await runCollect(w);
    expect(first.retried).toBeGreaterThan(0);
    const second = await runCollect(w);
    expect(second.dropped).toBeGreaterThanOrEqual(first.retried);
    expect(await rows(comments)).toBe(0);
  });

  it("drops a post whose candidates the judge scores unsafe", async () => {
    const w = await worker({
      responder: (req) => {
        const out = fakeResponder(req) as { scores?: { safe: number }[] };
        if (req.callType === "judge") out.scores!.forEach((s) => (s.safe = 1));
        return out;
      },
    });
    let submittedPosts = 0;
    for (let i = 0; i < 8 && submittedPosts === 0; i++) {
      await runTick(w, tickAt(i));
      submittedPosts = (await runCollect(w)).followUpBatchId ? 1 : 0;
    }
    const judged = await runCollect(w);
    expect(judged.judged).toBeGreaterThan(0);
    expect(judged.posts).toBe(0);
    expect(await rows(posts)).toBe(0);
  });
});

describe("HTTP server", () => {
  it("routes Pub/Sub pushes, reports health, and 500s on failure", async () => {
    const w = await worker();
    const server = createWorkerServer(w).listen(0);
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const push = (path: string, publishTime: string) =>
      fetch(`${base}${path}`, {
        method: "POST",
        body: JSON.stringify({
          message: { data: "", publishTime, messageId: "1" },
          subscription: "s",
        }),
      });
    try {
      expect(await (await fetch(`${base}/healthz`)).text()).toBe("ok");
      expect((await fetch(`${base}/nope`, { method: "POST" })).status).toBe(404);
      expect((await fetch(`${base}/tick`)).status).toBe(404);

      const tick = await push("/tick", T0.toISOString());
      expect(tick.status).toBe(200);
      const body = (await tick.json()) as { tickId: string; claimed: number };
      expect(body.tickId).toBe(T0.toISOString());
      expect(body.claimed).toBeGreaterThan(0);
      // Pub/Sub redelivers the same message: acked, and nothing new happens.
      const replay = (await (await push("/tick", T0.toISOString())).json()) as { skipped: string };
      expect(replay.skipped).toBe("already_ran");

      expect((await push("/collect", T0.toISOString())).status).toBe(200);
      expect((await push("/event", T0.toISOString())).status).toBe(200);
      expect((await push("/nightly", T0.toISOString())).status).toBe(200);
      // A malformed body falls back to the clock.
      expect((await fetch(`${base}/event`, { method: "POST", body: "{not json" })).status).toBe(
        200,
      );

      w.llm.submitBatch = () => Promise.reject(new Error("anthropic down"));
      expect((await push("/tick", tickAt(1).toISOString())).status).toBe(500);
      expect(w.logs.some((l) => l.event === "handler_error")).toBe(true);
    } finally {
      server.close();
    }
  });

  it("reads the logical time from a Pub/Sub message", () => {
    const fallback = new Date("2026-01-01T00:00:00Z");
    expect(messageTime({ message: { publishTime: "2026-11-16T09:07:00Z" } }, fallback)).toEqual(
      new Date("2026-11-16T09:07:00Z"),
    );
    expect(messageTime({ message: { publishTime: "garbage" } }, fallback)).toBe(fallback);
    expect(messageTime(undefined, fallback)).toBe(fallback);
  });
});

describe("helpers", () => {
  it("aligns ticks and seeds them stably", () => {
    expect(tickStart(new Date("2026-11-16T09:14:59Z"), 15)).toEqual(
      new Date("2026-11-16T09:00:00Z"),
    );
    expect(seedFor("a")).toBe(seedFor("a"));
    expect(seedFor("a")).not.toBe(seedFor("b"));
  });

  it("splits seeded notes by who they mention", () => {
    const seed = content.houseRelationships[0]!;
    const names = new Map(content.houseBots.map((b) => [b.id, b.name]));
    const [ab, ba] = relationshipSides(seed, names, T0);
    expect(ab).toMatchObject({ from: seed.a, to: seed.b, stage: seed.a_to_b.stage });
    expect(ba).toMatchObject({ from: seed.b, to: seed.a, stage: seed.b_to_a.stage });
    const unknown = relationshipSides({ ...seed, notes: ["nobody named"] }, new Map(), T0);
    expect(unknown[0]!.notes).toEqual(["nobody named"]);
    expect(unknown[1]!.notes).toEqual([]);
  });

  it("builds a persona card from stored canon, tolerating missing lists", async () => {
    const w = await worker();
    const brock = (await w.repos.listPersonas()).find((p) => p.id === "brock-halvorsen")!;
    expect(personaCard(brock)).toMatchObject({
      id: "brock-halvorsen",
      subtext: expect.any(String),
    });
    expect(personaCard({ ...brock, canon: {} }).canon).toEqual({
      family: [],
      employers: [],
      facts: [],
    });
  });

  it("logs JSON for Cloud Logging", () => {
    const lines: string[] = [];
    const orig = console.log;
    console.log = (s: string) => lines.push(s);
    try {
      jsonLogger()("tick", { claimed: 3 });
    } finally {
      console.log = orig;
    }
    expect(JSON.parse(lines[0]!)).toEqual({ severity: "INFO", message: "tick", claimed: 3 });
  });
});

describe("relationships", () => {
  it("reactions and comments move relationships (FR-18)", async () => {
    const w = await worker();
    const before = await w.repos.allRelationships();
    await runTicks(w, 10);
    const after = await w.repos.allRelationships();
    expect(after.length).toBeGreaterThan(before.length);
    const changed = after.filter(
      (r) =>
        r.rel.affinity !== 0 &&
        !before.some((b) => b.rel.from === r.rel.from && b.rel.to === r.rel.to),
    );
    expect(changed.length).toBeGreaterThan(0);
    // Seeded backstory survives the triggers.
    const seeded = after.filter((r) => r.history);
    expect(seeded.length).toBe(before.filter((r) => r.history).length);
    expect(await db().select().from(posts).where(eq(posts.personaId, "nobody"))).toEqual([]);
  });
});

describe("escalation ladder", () => {
  it("reconciles a public exit overnight, mirrors it, and writes the owed ladder post", async () => {
    const w = await worker({ config: { grudge: { reconciliationBaseDailyProbability: 1 } } });
    const [a, b] = content.houseBots.slice(0, 2).map((x) => x.id) as [string, string];
    const exit = {
      affinity: -0.9,
      stage: "public_exit" as const,
      stageSince: new Date(T0.getTime() - 10 * MS_PER_DAY),
      notes: [],
    };
    await w.repos.saveRelationship({ from: a, to: b, ...exit });
    await w.repos.saveRelationship({ from: b, to: a, ...exit });

    const night = await runNightly(w, new Date(T0.getTime() + MS_PER_DAY));
    expect(night.transitions).toBeGreaterThanOrEqual(2);
    const rels = await w.repos.allRelationships();
    const stage = (from: string, to: string) =>
      rels.find((r) => r.rel.from === from && r.rel.to === to)?.rel.stage;
    expect(stage(a, b)).toBe("reconciled");
    expect(stage(b, a)).toBe("reconciled");
    const owedA = (await w.repos.listPersonas()).find((p) => p.id === a)!.pendingPosts;
    expect(owedA).toContainEqual({ format: "reconciliation", targetId: b });

    // The next day, after 08:00, the owed post replaces a planned post.
    const nextDay = new Date(T0.getTime() + MS_PER_DAY);
    let written: (typeof posts.$inferSelect)[] = [];
    for (let i = 0; i < 4 && written.length === 0; i++) {
      const t = new Date(nextDay.getTime() + i * 15 * MS_PER_MINUTE);
      w.clock.set(t);
      await runTick(w, t);
      await runCollect(w);
      await runCollect(w);
      written = (await db().select().from(posts).where(eq(posts.personaId, a))).filter(
        (p) => p.format === "reconciliation",
      );
    }
    expect(written).toHaveLength(1);
    expect(written[0]!.grudgeTargetId).toBe(b);
    const owedAfter = (await w.repos.listPersonas()).find((p) => p.id === a)!.pendingPosts;
    expect(owedAfter).not.toContainEqual({ format: "reconciliation", targetId: b });
  });
});

describe("CR-3 batch SLA", () => {
  it("logs a batch still running after 2 hours", async () => {
    const w = await worker();
    await runTick(w, T0);
    w.llm.batchEnded = () => Promise.resolve(false);
    w.clock.set(new Date(T0.getTime() + 30 * MS_PER_MINUTE));
    expect((await runCollect(w)).overdue).toBe(0);
    w.clock.set(new Date(T0.getTime() + 3 * 60 * MS_PER_MINUTE));
    const late = await runCollect(w);
    expect(late).toMatchObject({ overdue: 1, batchesCollected: 0 });
    expect(w.logs.some((l) => l.event === "batch_sla_exceeded")).toBe(true);
  });
});
