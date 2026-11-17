// Production entry point (Cloud Run). Configuration comes from the environment:
//   DATABASE_URL                              Postgres (Cloud SQL private IP)
//   HUMBLED_ANTHROPIC_API_KEY | ANTHROPIC_API_KEY   from Secret Manager
//   PORT                                      set by Cloud Run
//   HUMBLED_CONFIG                            optional JSON overrides for @humbled/config
import { configOverrides, loadConfig } from "@humbled/config";
import { loadContent } from "@humbled/content";
import { connect, migrate, PgSpendLedger, Repositories } from "@humbled/db";
import { AnthropicLLMClient } from "@humbled/llm";
import { jsonLogger } from "./deps.ts";
import { syncContent } from "./seed.ts";
import { createWorkerServer } from "./server.ts";

const required = (name: string, value: string | undefined): string => {
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

const config = loadConfig(configOverrides(process.env.HUMBLED_CONFIG));
const content = loadContent();
const db = connect(required("DATABASE_URL", process.env.DATABASE_URL));
const log = jsonLogger();
const clock = { now: () => new Date() };

await migrate(db.db);
const repos = new Repositories(db.db);
await syncContent(repos, content, clock.now());

const apiKey = required(
  "HUMBLED_ANTHROPIC_API_KEY",
  process.env.HUMBLED_ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY,
);
const server = createWorkerServer({
  repos,
  ledger: new PgSpendLedger(db.db),
  llm: new AnthropicLLMClient({ apiKey, llm: config.llm }),
  content,
  config,
  clock,
  log,
});
const port = Number(process.env.PORT ?? 8080);
server.listen(port, () => log("worker_listening", { port }));

const shutdown = () => server.close(() => void db.close().then(() => process.exit(0)));
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
