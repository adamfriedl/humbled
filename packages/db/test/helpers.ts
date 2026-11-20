import { sql } from "drizzle-orm";
import { afterAll, beforeEach, inject } from "vitest";
import { connect, type DbHandle } from "../src/client.ts";
import { Repositories, type PersonaSeed } from "../src/repositories.ts";

const TABLES = [
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

/** A connection per test file, with every table emptied before each test. */
export function useDb(): { h: () => DbHandle; repos: () => Repositories } {
  const handle = connect(inject("databaseUrl"));
  const repos = new Repositories(handle.db);
  beforeEach(async () => {
    await handle.db.execute(sql.raw(`truncate ${TABLES.join(", ")} cascade`));
  });
  afterAll(() => handle.close());
  return { h: () => handle, repos: () => repos };
}

export const seed = (id: string, over: Partial<PersonaSeed> = {}): PersonaSeed => ({
  id,
  type: "hustle_bro",
  name: id,
  title: "Founder",
  company: "Grindstone Capital",
  origin: "Sold knives at 14.",
  frequency: "normal",
  canon: { facts: ["Owns two cold plunges"] },
  ...over,
});

export const T0 = new Date("2026-11-16T12:00:00.000Z");
export const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
