import { meanPairwiseOverlap, type JudgeScore } from "@humbled/comedy";
import { MS_PER_DAY, type PersonaType } from "@humbled/domain";
import type { CallRecord, Simulation } from "./engine.ts";
import type { SimComment, SimPost } from "./world.ts";

const STAGE_LABEL: Record<string, string> = {
  neutral: "neutral",
  cold: "cold",
  vague_posting: "vague-posting",
  comment_war: "comment war",
  public_exit: "public exit",
  reconciled: "reconciled",
};

const fmtScore = (s?: JudgeScore) =>
  s
    ? `funny ${s.funny} · voice ${s.in_voice} · specific ${s.specific} · safe ${s.safe}${s.note ? ` — "${s.note}"` : ""}`
    : "unscored";

const quote = (text: string) =>
  text
    .trim()
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const usd = (n: number) => `$${n.toFixed(n < 0.01 ? 5 : 4)}`;

function time(d: Date): string {
  return d.toISOString().slice(11, 16);
}

// ---------------------------------------------------------------- transcript

export function transcript(sim: Simulation): string {
  const w = sim.world;
  const name = (id: string) => w.persona(id).card.name;
  const out: string[] = [`# Humbled simulation transcript`, ""];
  out.push(
    `${w.personas.size} personas, ${sim.daysSimulated().toFixed(sim.stoppedAt ? 2 : 0)} of ${sim.options.days} days, starting ${sim.options.start.toISOString().slice(0, 10)}.${sim.stoppedAt ? " Stopped early at the spend cap." : ""}`,
    "",
    "## Cast",
    "",
    ...[...w.personas.values()].map(
      (p) => `- **${p.card.name}**, ${p.card.title} (${p.card.company}) · ${p.card.type}`,
    ),
    "",
    "## Starting relationships",
    "",
    ...sim.initialRelationships
      .filter((r) => r.rel.stage !== "neutral" || Math.abs(r.rel.affinity) >= 0.5)
      .map(
        (r) =>
          `- ${name(r.rel.from)} → ${name(r.rel.to)}: ${STAGE_LABEL[r.rel.stage]} (affinity ${r.rel.affinity.toFixed(2)})`,
      ),
    "",
  );

  for (let day = 0; day < sim.options.days; day++) {
    const date = new Date(sim.options.start.getTime() + day * MS_PER_DAY);
    out.push(`## Day ${day + 1} · ${date.toDateString()}`, "");
    const event = sim.eventForDay(day);
    if (event) out.push(`📰 **World event:** ${event.headline}`, "");

    const posts = [...w.posts.values()]
      .filter((p) => p.day === day)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    for (const post of posts) out.push(...renderPost(sim, post), "");

    const transitions = w.transitions.filter((t) => t.day === day);
    if (transitions.length) {
      out.push("### Overnight", "");
      for (const t of transitions) {
        out.push(
          `- ${name(t.fromId)} → ${name(t.toId)}: ${STAGE_LABEL[t.transition.from]} → **${STAGE_LABEL[t.transition.to]}**`,
        );
      }
      out.push("");
    }
  }
  return out.join("\n");
}

function renderPost(sim: Simulation, post: SimPost): string[] {
  const w = sim.world;
  const author = w.persona(post.authorId).card;
  const fmt = sim.content.formats[post.format]?.label ?? post.format;
  const tags = post.hashtags.length ? `\n>\n> ${post.hashtags.map((h) => `#${h}`).join(" ")}` : "";
  const extras = [
    post.grudgeTargetId ? `re: ${w.persona(post.grudgeTargetId).card.name}` : "",
    post.callbackPostId ? `callback to ${post.callbackPostId}` : "",
  ].filter(Boolean);
  const lines = [
    `### ${author.name} · ${fmt} · ${time(post.createdAt)}${extras.length ? ` · _${extras.join(", ")}_` : ""}`,
    "",
    quote(post.body) + tags,
    "",
    `_${fmtScore(post.judge)} · ${post.reactions.size} reactions · ${post.commentIds.length} comments · engagement ${post.engagementScore.toFixed(1)}_`,
  ];
  const comments = w.commentsOn(post.id);
  const render = (c: SimComment, indent: number): string[] => [
    `${"  ".repeat(indent)}- **${w.persona(c.authorId).card.name}**${c.grudge ? " ⚔️" : ""}: ${c.body.replace(/\n+/g, " ")}`,
    ...comments.filter((x) => x.parentId === c.id).flatMap((x) => render(x, indent + 1)),
  ];
  const top = comments.filter((c) => !c.parentId);
  if (top.length) lines.push("", ...top.flatMap((c) => render(c, 0)));
  if (post.losers.length) {
    lines.push(
      "",
      `<details><summary>${post.losers.length} other candidate${post.losers.length > 1 ? "s" : ""} the judge passed over</summary>`,
      "",
      ...post.losers.flatMap((l) => [quote(l.body), "", `_${fmtScore(l.judge)}_`, ""]),
      "</details>",
    );
  }
  return lines;
}

// ---------------------------------------------------------------- judge report

export interface GateResult {
  avgFunny: number;
  minTypeFunny: { type: string; avg: number } | undefined;
  reconciliations: number;
  costPerPersonaDay: number;
  convergedTypes: { type: string; overlap: number }[];
  checks: { label: string; pass: boolean; detail: string }[];
}

function postsByType(sim: Simulation): Map<PersonaType, SimPost[]> {
  const m = new Map<PersonaType, SimPost[]>();
  for (const post of sim.world.posts.values()) {
    const t = sim.world.persona(post.authorId).card.type;
    m.set(t, [...(m.get(t) ?? []), post]);
  }
  return m;
}

export function judgeReport(sim: Simulation): string {
  const posts = [...sim.world.posts.values()];
  const scored = posts.filter((p) => p.judge);
  const out = [
    "# Judge report",
    "",
    `${scored.length} of ${posts.length} posts scored (winners only).`,
    "",
  ];

  const table = (title: string, groups: Map<string, SimPost[]>) => {
    out.push(
      `## ${title}`,
      "",
      "| | posts | funny | in-voice | specific | safe |",
      "|---|---|---|---|---|---|",
    );
    for (const [k, ps] of [...groups.entries()].sort()) {
      const s = ps.flatMap((p) => (p.judge ? [p.judge] : []));
      out.push(
        `| ${k} | ${ps.length} | ${mean(s.map((x) => x.funny)).toFixed(2)} | ${mean(s.map((x) => x.in_voice)).toFixed(2)} | ${mean(s.map((x) => x.specific)).toFixed(2)} | ${mean(s.map((x) => x.safe)).toFixed(2)} |`,
      );
    }
    out.push("");
  };
  table("By persona type", postsByType(sim));
  const byFormat = new Map<string, SimPost[]>();
  for (const p of posts) byFormat.set(p.format, [...(byFormat.get(p.format) ?? []), p]);
  table("By format", byFormat);

  out.push("## Funny distribution (winners)", "");
  for (let s = 1; s <= 5; s++) {
    const n = scored.filter((p) => p.judge!.funny === s).length;
    out.push(`- ${s}: ${"█".repeat(n)} ${n}`);
  }
  const loserScores = posts.flatMap((p) =>
    p.losers.flatMap((l) => (l.judge ? [l.judge.funny] : [])),
  );
  out.push(
    "",
    "## What best-of-N buys",
    "",
    `Mean funny of winners: ${mean(scored.map((p) => p.judge!.funny)).toFixed(2)}; of candidates passed over: ${mean(loserScores).toFixed(2)}.`,
    "",
    "## Rejections and drops",
    "",
    ...Object.entries(sim.stats.rejections).map(([k, v]) => `- ${k}: ${v}`),
    `- actions dropped: ${sim.stats.droppedActions}`,
    "",
    "## Repetition (mean pairwise trigram overlap within a type)",
    "",
    ...[...postsByType(sim).entries()]
      .sort()
      .map(([t, ps]) => `- ${t}: ${meanPairwiseOverlap(ps.map((p) => p.body)).toFixed(3)}`),
    "",
  );
  return out.join("\n");
}

// ---------------------------------------------------------------- cost report

export function costReport(sim: Simulation): string {
  const calls = sim.stats.calls;
  const personaDays = sim.world.personas.size * sim.daysSimulated();
  const sum = (cs: CallRecord[], k: keyof CallRecord) =>
    cs.reduce((s, c) => s + (c[k] as number), 0);
  const out = [
    "# Cost report",
    "",
    `Transport: ${sim.options.transport}. "Projected" prices the same tokens at batch rates, which is how production runs ticks (CR-3).`,
    "",
    "| call type | calls | failed | input | cache read | cache write | output | actual | projected (batch) |",
    "|---|---|---|---|---|---|---|---|---|",
  ];
  const types = [...new Set(calls.map((c) => c.callType))].sort();
  for (const t of [...types, "total"]) {
    const cs = t === "total" ? calls : calls.filter((c) => c.callType === t);
    out.push(
      `| ${t} | ${cs.length} | ${cs.filter((c) => !c.ok).length} | ${sum(cs, "inputTokens")} | ${sum(cs, "cacheReadTokens")} | ${sum(cs, "cacheWriteTokens")} | ${sum(cs, "outputTokens")} | ${usd(sum(cs, "costUsd"))} | ${usd(sum(cs, "projectedBatchCostUsd"))} |`,
    );
  }
  const projected = sum(calls, "projectedBatchCostUsd");
  const cacheable =
    sum(calls, "cacheReadTokens") + sum(calls, "cacheWriteTokens") + sum(calls, "inputTokens");
  out.push(
    "",
    `- Persona-days: ${personaDays}`,
    `- Projected cost per persona-day: ${usd(personaDays ? projected / personaDays : 0)} (target ≤ ${usd(sim.config.eval.maxCostPerPersonaDayUsd)})`,
    `- Projected cost per persona-month (×30): ${usd(personaDays ? (projected / personaDays) * 30 : 0)} (PRD target ~$0.10)`,
    `- Cache hit rate (cache-read share of input): ${cacheable ? ((100 * sum(calls, "cacheReadTokens")) / cacheable).toFixed(1) : "0"}%`,
    "",
  );
  const failures = new Map<string, number>();
  for (const c of calls) {
    if (c.ok) continue;
    const k = `${c.callType}: ${c.error ?? "unknown"}`;
    failures.set(k, (failures.get(k) ?? 0) + 1);
  }
  if (failures.size) {
    out.push("Failed calls by reason:", "");
    for (const [k, n] of [...failures].sort((a, b) => b[1] - a[1])) out.push(`- ${k}: ${n}`);
    out.push("");
  }
  return out.join("\n");
}

// ---------------------------------------------------------------- gate

export function gate(sim: Simulation): GateResult {
  const e = sim.config.eval;
  const scored = [...sim.world.posts.values()].filter((p) => p.judge);
  const avgFunny = mean(scored.map((p) => p.judge!.funny));
  const typeAvgs = [...postsByType(sim).entries()]
    .map(([type, ps]) => ({ type, avg: mean(ps.flatMap((p) => (p.judge ? [p.judge.funny] : []))) }))
    .sort((a, b) => a.avg - b.avg);
  const minTypeFunny = typeAvgs[0];
  const reconciliations = sim.world.transitions.filter(
    (t) => t.transition.to === "reconciled",
  ).length;
  const personaDays = sim.world.personas.size * sim.daysSimulated();
  const costPerPersonaDay = personaDays
    ? sim.stats.calls.reduce((s, c) => s + c.projectedBatchCostUsd, 0) / personaDays
    : 0;
  const convergedTypes = [...postsByType(sim).entries()]
    .map(([type, ps]) => ({ type, overlap: meanPairwiseOverlap(ps.map((p) => p.body)) }))
    .filter((t) => t.overlap > e.maxTypeTrigramOverlap);
  const checks = [
    {
      label: `Judge average funny ≥ ${e.minAvgFunny}`,
      pass: avgFunny >= e.minAvgFunny,
      detail: avgFunny.toFixed(2),
    },
    {
      label: `No persona type below ${e.minTypeAvgFunny}`,
      pass: !minTypeFunny || minTypeFunny.avg >= e.minTypeAvgFunny,
      detail: minTypeFunny
        ? `lowest: ${minTypeFunny.type} ${minTypeFunny.avg.toFixed(2)}`
        : "no posts",
    },
    {
      label: "At least one feud reaches reconciliation",
      pass: reconciliations > 0,
      detail: `${reconciliations} reconciliation(s)`,
    },
    {
      label: `Projected cost per persona-day ≤ ${usd(e.maxCostPerPersonaDayUsd)}`,
      pass: costPerPersonaDay <= e.maxCostPerPersonaDayUsd,
      detail: usd(costPerPersonaDay),
    },
    {
      label: "No persona type's posts converging",
      pass: convergedTypes.length === 0,
      detail: convergedTypes.length
        ? convergedTypes.map((t) => `${t.type} ${t.overlap.toFixed(3)}`).join(", ")
        : "ok",
    },
  ];
  return { avgFunny, minTypeFunny, reconciliations, costPerPersonaDay, convergedTypes, checks };
}

export function gateMarkdown(sim: Simulation, fake: boolean): string {
  const g = gate(sim);
  return [
    "# Phase 0 gate",
    "",
    fake
      ? "> ⚠️ **FAKE mode.** Output came from the offline stub, not the model. Scores and text are meaningless; this run only tests the harness.\n"
      : "",
    ...g.checks.map((c) => `- [${c.pass ? "x" : " "}] ${c.label}: ${c.detail}`),
    "- [ ] Adam reads the transcript, laughs at least once per simulated day, and finds no feud that stalls or repeats (human gate)",
    "",
    `Posts: ${sim.world.posts.size} · comments: ${sim.world.comments.size} · LLM calls: ${sim.stats.calls.length}`,
    "",
  ].join("\n");
}
