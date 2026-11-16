// CR-8 backstop: when the monthly billing budget is spent, pause every Cloud Scheduler job in
// the project's region, which stops ticks (and so LLM spend). Billing data lags by hours, so the
// CR-7 daily ledger is the primary control; this catches what it misses.

/** True when a budget notification says spend has reached the budget. */
export function overBudget(notification) {
  const cost = Number(notification?.costAmount);
  const budget = Number(notification?.budgetAmount);
  return Number.isFinite(cost) && Number.isFinite(budget) && budget > 0 && cost >= budget;
}

/** Decode the Pub/Sub message a budget publishes (base64 JSON in message.data). */
export function decode(cloudEvent) {
  const data = cloudEvent?.data?.message?.data;
  if (!data) return undefined;
  try {
    return JSON.parse(Buffer.from(data, "base64").toString("utf8"));
  } catch {
    return undefined;
  }
}

async function accessToken(fetchImpl) {
  const res = await fetchImpl(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    { headers: { "Metadata-Flavor": "Google" } },
  );
  if (!res.ok) throw new Error(`metadata token: ${res.status}`);
  return (await res.json()).access_token;
}

/** Pause every enabled job in projects/{project}/locations/{region}. Returns the names paused. */
export async function pauseAll({ project, region, fetchImpl = fetch }) {
  const token = await accessToken(fetchImpl);
  const auth = { Authorization: `Bearer ${token}` };
  const base = `https://cloudscheduler.googleapis.com/v1/projects/${project}/locations/${region}/jobs`;
  const paused = [];
  let pageToken = "";
  do {
    const res = await fetchImpl(`${base}${pageToken ? `?pageToken=${pageToken}` : ""}`, {
      headers: auth,
    });
    if (!res.ok) throw new Error(`list jobs: ${res.status}`);
    const body = await res.json();
    for (const job of body.jobs ?? []) {
      if (job.state !== "ENABLED") continue;
      const p = await fetchImpl(`https://cloudscheduler.googleapis.com/v1/${job.name}:pause`, {
        method: "POST",
        headers: auth,
      });
      if (!p.ok) throw new Error(`pause ${job.name}: ${p.status}`);
      paused.push(job.name);
    }
    pageToken = body.nextPageToken ?? "";
  } while (pageToken);
  return paused;
}

/** The function body: decode, check, pause. */
export async function handle(cloudEvent, env = process.env, fetchImpl = fetch) {
  const n = decode(cloudEvent);
  if (!overBudget(n)) return { action: "none", cost: n?.costAmount, budget: n?.budgetAmount };
  const paused = await pauseAll({ project: env.PROJECT_ID, region: env.REGION, fetchImpl });
  console.log(
    JSON.stringify({ severity: "ALERT", message: "kill_switch_paused_scheduler", paused, ...n }),
  );
  return { action: "paused", paused };
}
