// Run with `node --test` (CI runs it in the infra job).
import assert from "node:assert/strict";
import { test } from "node:test";
import { decode, handle, overBudget, pauseAll } from "./kill-switch.mjs";

const event = (n) => ({
  data: { message: { data: Buffer.from(JSON.stringify(n)).toString("base64") } },
});

/** A fake fetch that serves a metadata token, two pages of jobs, and pause calls. */
function fakeFetch() {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? "GET" });
    const json = (body) => ({ ok: true, status: 200, json: async () => body });
    if (url.includes("metadata.google.internal")) return json({ access_token: "t" });
    if (url.endsWith(":pause")) return json({});
    if (url.includes("pageToken=p2"))
      return json({ jobs: [{ name: "projects/p/locations/r/jobs/c", state: "ENABLED" }] });
    return json({
      jobs: [
        { name: "projects/p/locations/r/jobs/a", state: "ENABLED" },
        { name: "projects/p/locations/r/jobs/b", state: "PAUSED" },
      ],
      nextPageToken: "p2",
    });
  };
  return { fetchImpl, calls };
}

test("overBudget only at or past 100%", () => {
  assert.equal(overBudget({ costAmount: 99.99, budgetAmount: 100 }), false);
  assert.equal(overBudget({ costAmount: 100, budgetAmount: 100 }), true);
  assert.equal(overBudget({ costAmount: 1, budgetAmount: 0 }), false);
  assert.equal(overBudget(undefined), false);
});

test("decode tolerates missing or malformed data", () => {
  assert.deepEqual(decode(event({ costAmount: 1 })), { costAmount: 1 });
  assert.equal(decode({}), undefined);
  assert.equal(decode({ data: { message: { data: "bm90IGpzb24=" } } }), undefined);
});

test("pauses every enabled job across pages", async () => {
  const { fetchImpl, calls } = fakeFetch();
  const paused = await pauseAll({ project: "p", region: "r", fetchImpl });
  assert.deepEqual(paused, ["projects/p/locations/r/jobs/a", "projects/p/locations/r/jobs/c"]);
  assert.equal(calls.filter((c) => c.method === "POST").length, 2);
});

test("handle does nothing under budget and pauses over it", async () => {
  const { fetchImpl, calls } = fakeFetch();
  const env = { PROJECT_ID: "p", REGION: "r" };
  assert.equal(
    (await handle(event({ costAmount: 5, budgetAmount: 30 }), env, fetchImpl)).action,
    "none",
  );
  assert.equal(calls.length, 0);
  const log = console.log;
  console.log = () => {};
  try {
    const r = await handle(event({ costAmount: 31, budgetAmount: 30 }), env, fetchImpl);
    assert.equal(r.action, "paused");
    assert.equal(r.paused.length, 2);
  } finally {
    console.log = log;
  }
});

test("surfaces API failures so Pub/Sub retries", async () => {
  const failing = async () => ({ ok: false, status: 403, json: async () => ({}) });
  await assert.rejects(
    pauseAll({ project: "p", region: "r", fetchImpl: failing }),
    /metadata token: 403/,
  );
});
