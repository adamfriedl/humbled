import { loadConfig, type ConfigInput } from "@humbled/config";
import { loadContent } from "@humbled/content";
import { connect, PgSpendLedger, Repositories } from "@humbled/db";
import { fixedClock } from "@humbled/domain";
import { FakeLLMClient, fakeResponder, type FakeResponder } from "@humbled/llm";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, inject } from "vitest";
import type { WorkerDeps } from "../src/deps.ts";
import { syncContent } from "../src/seed.ts";

const TABLES = [
  "rate_events",
  "ip_salts",
  "job_runs",
  "reports",
  "spend_ledger",
  "deferred_follow_ups",
  "llm_batches",
  "actions",
  "nudges",
  "career_events",
  "endorsements",
  "follows",
  "reactions",
  "comments",
  "posts",
  "world_events",
  "relationships",
  "persona_memory",
  "personas",
  "owners",
];

export const content = loadContent();
/** 09:00 UTC: past the 08:00 line for owed ladder posts. */
export const T0 = new Date("2026-11-16T09:00:00.000Z");

const handle = connect(inject("databaseUrl"));
afterAll(() => handle.close());
beforeEach(async () => {
  await handle.db.execute(sql.raw(`truncate ${TABLES.join(", ")} cascade`));
});

export interface TestWorker extends WorkerDeps {
  llm: FakeLLMClient;
  logs: { event: string; fields: Record<string, unknown> }[];
  clock: ReturnType<typeof fixedClock>;
}

/** Deps over the shared test database, with content synced and a fake model. */
export async function worker(
  opts: { config?: ConfigInput; responder?: FakeResponder; now?: Date } = {},
): Promise<TestWorker> {
  const repos = new Repositories(handle.db);
  const config = loadConfig({ ...opts.config });
  const clock = fixedClock(opts.now ?? T0);
  const logs: TestWorker["logs"] = [];
  await syncContent(repos, content, clock.now());
  return {
    repos,
    ledger: new PgSpendLedger(handle.db),
    llm: new FakeLLMClient(opts.responder ?? fakeResponder, config.llm),
    content,
    config,
    clock,
    log: (event, fields = {}) => logs.push({ event, fields }),
    logs,
  };
}

export const db = () => handle.db;
