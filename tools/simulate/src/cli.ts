import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { loadConfig } from "@humbled/config";
import { loadContent } from "@humbled/content";
import { seededRandom } from "@humbled/domain";
import {
  AnthropicLLMClient,
  FakeLLMClient,
  InMemorySpendLedger,
  type LLMClient,
} from "@humbled/llm";
import { selectPersonas, Simulation } from "./engine.ts";
import { fakeResponder } from "./fake.ts";
import { costReport, gateMarkdown, judgeReport, transcript } from "./report.ts";

const { values } = parseArgs({
  options: {
    personas: { type: "string", default: "10" },
    days: { type: "string", default: "7" },
    seed: { type: "string", default: "1" },
    fake: { type: "boolean", default: false },
    concurrency: { type: "string", default: "6" },
    out: { type: "string" },
  },
});

const config = loadConfig();
const content = loadContent();
const seed = Number(values.seed);
const random = seededRandom(seed);
const personaIds = selectPersonas(content, Number(values.personas), random);

let llm: LLMClient;
if (values.fake) {
  llm = new FakeLLMClient(fakeResponder, config.llm);
} else {
  // HUMBLED_ANTHROPIC_API_KEY first, so the key can live in a shared environment (e.g. a
  // cloud dev container) without other tools picking it up as their own ANTHROPIC_API_KEY.
  const apiKey = process.env.HUMBLED_ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? "";
  if (!apiKey) {
    console.error(
      "Set HUMBLED_ANTHROPIC_API_KEY (or ANTHROPIC_API_KEY), or run with FAKE=1 to test the harness offline.",
    );
    process.exit(2);
  }
  llm = new AnthropicLLMClient({ apiKey, llm: config.llm });
}

const sim = new Simulation(content, config, llm, new InMemorySpendLedger(), random, {
  personaIds,
  days: Number(values.days),
  start: new Date("2026-11-16T00:00:00Z"),
  transport: "realtime",
  concurrency: Number(values.concurrency),
});

const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../..");
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir =
  values.out ??
  join(repoRoot, "tools/simulate/runs", `${stamp}${values.fake ? "-fake" : ""}-s${seed}`);

console.log(
  `Simulating ${personaIds.length} personas for ${values.days} days (seed ${seed}${values.fake ? ", FAKE" : ""})`,
);
const started = Date.now();
await sim.run((day) => {
  const cost = sim.stats.calls.reduce((s, c) => s + c.costUsd, 0);
  console.log(
    `  day ${day + 1}: ${sim.world.posts.size} posts, ${sim.world.comments.size} comments, ${sim.stats.calls.length} calls, $${cost.toFixed(4)}`,
  );
});

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "transcript.md"), transcript(sim));
writeFileSync(join(outDir, "judge-report.md"), judgeReport(sim));
writeFileSync(join(outDir, "cost-report.md"), costReport(sim));
const gateText = gateMarkdown(sim, values.fake);
writeFileSync(join(outDir, "gate.md"), gateText);
console.log(`\n${gateText}\nWrote ${outDir} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
