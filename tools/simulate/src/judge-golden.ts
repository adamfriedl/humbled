// Judge calibration: score every golden candidate (and optionally a past run's top posts) with
// the real judge, one post per call, and report how scores split by approval. A useful judge
// scores Adam's approved posts above the ones he passed over, and keeps 5s rare.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { buildJudgePrompt, JudgeOutputSchema } from "@humbled/comedy";
import { loadConfig } from "@humbled/config";
import { loadContent } from "@humbled/content";
import type { PersonaType, PostFormat } from "@humbled/domain";
import { AnthropicLLMClient } from "@humbled/llm";

const { values } = parseArgs({
  options: {
    // A transcript.md from a past run: its posts the old judge scored 5 are re-judged too.
    transcript: { type: "string" },
    concurrency: { type: "string", default: "6" },
  },
});

interface Item {
  id: string;
  group: string;
  type: PersonaType;
  format: PostFormat;
  body: string;
}

const config = loadConfig();
const content = loadContent();
const apiKey = process.env.HUMBLED_ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? "";
if (!apiKey) {
  console.error("Set HUMBLED_ANTHROPIC_API_KEY (or ANTHROPIC_API_KEY).");
  process.exit(2);
}
const llm = new AnthropicLLMClient({ apiKey, llm: config.llm });

const items: Item[] = content.golden.map((g) => ({
  id: g.id,
  group: g.anchor ? "anchor" : g.approved ? "approved" : "passed over",
  type: g.type,
  format: g.format,
  body: g.body,
}));

if (values.transcript) {
  // Post blocks look like: "### Name · Format Label · hh:mm", "> body" lines, then
  // "_funny 5 · voice ...". Map the persona name and format label back to ids.
  const typeByName = new Map(content.houseBots.map((b) => [b.name, b.type]));
  const formatByLabel = new Map(
    Object.entries(content.formats).map(([id, f]) => [f.label, id as PostFormat]),
  );
  const blocks = readFileSync(values.transcript, "utf8").split(/^### /m).slice(1);
  let n = 0;
  for (const block of blocks) {
    const head = /^(.+?) · (.+?) · \d\d:\d\d/.exec(block);
    if (!head || !/^_funny 5 /m.test(block)) continue;
    const type = typeByName.get(head[1]!);
    const format = formatByLabel.get(head[2]!);
    if (!type || !format) continue;
    // Only the winner: passed-over candidates follow in a <details> section, quoted the same way.
    const body = block
      .split("<details>")[0]!
      .split("\n")
      .filter((l) => l.startsWith("> ") || l === ">")
      .map((l) => l.slice(2))
      .join("\n")
      .trim();
    items.push({ id: `run-${++n}`, group: "past run: old judge 5", type, format, body });
  }
}

let next = 0;
const scored: { item: Item; funny?: number | undefined; note?: string | undefined }[] = [];
async function worker() {
  while (next < items.length) {
    const item = items[next++]!;
    // An anchor is one of the judge's own examples; leave it out while it's being scored, or the
    // judge marks it down as a copy of itself.
    const judgeContent =
      item.group === "anchor"
        ? { ...content, golden: content.golden.filter((g) => g.id !== item.id) }
        : content;
    const prompt = buildJudgePrompt(
      judgeContent,
      item.type,
      item.format,
      [{ body: item.body }],
      config,
    );
    const r = await llm.complete({ id: `cal_${item.id}`, callType: "judge", prompt });
    if (!r.ok) {
      scored.push({ item, note: `call failed: ${r.error}${r.detail ? ` (${r.detail})` : ""}` });
      continue;
    }
    try {
      const s = JudgeOutputSchema.parse(r.json).scores[0];
      scored.push({ item, funny: s?.funny, note: s?.note });
    } catch {
      scored.push({ item, note: `unparseable: ${JSON.stringify(r.json).slice(0, 120)}` });
    }
  }
}
await Promise.all(Array.from({ length: Number(values.concurrency) }, worker));

const groups = ["anchor", "approved", "passed over", "past run: old judge 5"];
console.log(
  "| group | n | mean funny | 1 | 2 | 3 | 4 | 5 | failed |\n|---|---|---|---|---|---|---|---|---|",
);
for (const g of groups) {
  const rs = scored.filter((s) => s.item.group === g);
  if (!rs.length) continue;
  const ok = rs.filter((s) => s.funny !== undefined).map((s) => s.funny!);
  const mean = ok.length ? (ok.reduce((a, b) => a + b, 0) / ok.length).toFixed(2) : "-";
  const dist = [1, 2, 3, 4, 5].map((v) => ok.filter((f) => f === v).length).join(" | ");
  console.log(`| ${g} | ${rs.length} | ${mean} | ${dist} | ${rs.length - ok.length} |`);
}
console.log("\nPer post:");
const order = (s: (typeof scored)[number]) => groups.indexOf(s.item.group) * 100 - (s.funny ?? 0);
for (const s of [...scored].sort((a, b) => order(a) - order(b))) {
  const preview = s.item.body.replace(/\s+/g, " ").slice(0, 70);
  console.log(`  ${s.funny ?? "?"}  ${s.item.group.padEnd(22)} ${s.item.id.padEnd(7)} ${preview}`);
  if (s.note) console.log(`       ${s.note}`);
}
