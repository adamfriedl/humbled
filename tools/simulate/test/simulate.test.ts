import { describe, expect, it } from "vitest";
import { loadConfig, type ConfigInput } from "@humbled/config";
import { loadContent } from "@humbled/content";
import { seededRandom } from "@humbled/domain";
import { FakeLLMClient, InMemorySpendLedger, type FakeResponder } from "@humbled/llm";
import { selectPersonas, Simulation } from "../src/engine.ts";
import { fakeResponder } from "../src/fake.ts";
import { costReport, gate, gateMarkdown, judgeReport, transcript } from "../src/report.ts";

const content = loadContent();
const START = new Date("2026-11-16T00:00:00Z");

function makeSim(
  opts: {
    personas?: number;
    days?: number;
    seed?: number;
    config?: ConfigInput;
    responder?: FakeResponder;
  } = {},
) {
  const config = loadConfig(opts.config ?? {});
  const random = seededRandom(opts.seed ?? 1);
  const personaIds = selectPersonas(content, opts.personas ?? 6, random);
  const llm = new FakeLLMClient(opts.responder ?? fakeResponder, config.llm);
  return new Simulation(content, config, llm, new InMemorySpendLedger(), random, {
    personaIds,
    days: opts.days ?? 2,
    start: START,
    transport: "realtime",
    concurrency: 4,
  });
}

describe("selectPersonas", () => {
  it("puts the latest-stage seeded feud first and fills across types", () => {
    const ids = selectPersonas(content, 10, seededRandom(1));
    expect(ids).toHaveLength(10);
    expect(new Set(ids).size).toBe(10);
    expect(ids.slice(0, 2).sort()).toEqual(["devon-ashby", "rafi-goldberg"]);
  });
  it("can select every house bot", () => {
    expect(selectPersonas(content, 100, seededRandom(1))).toHaveLength(content.houseBots.length);
  });
});

describe("Simulation (fake LLM)", () => {
  it("runs, posts, comments, and stays within quotas", async () => {
    const sim = makeSim();
    const days: number[] = [];
    await sim.run((d) => days.push(d));
    expect(days).toEqual([0, 1]);
    expect(sim.world.posts.size).toBeGreaterThan(0);
    expect(sim.world.comments.size).toBeGreaterThan(0);
    for (const p of sim.world.personas.values()) {
      for (const c of p.countsByDay.values()) {
        expect(c.posts).toBeLessThanOrEqual(4);
        expect(c.comments).toBeLessThanOrEqual(15);
      }
    }
    for (const c of sim.world.comments.values()) expect(c.depth).toBeLessThanOrEqual(3);
    // best-of-3: winners carry a judge score and two passed-over candidates
    const post = [...sim.world.posts.values()][0]!;
    expect(post.judge).toBeDefined();
    expect(post.losers).toHaveLength(2);
    // nightly summaries
    expect(
      [...sim.world.personas.values()].some((p) => p.careerSummary?.includes("FAKE summary")),
    ).toBe(true);
  });

  it("is deterministic for a seed", async () => {
    const a = makeSim({ seed: 7 });
    const b = makeSim({ seed: 7 });
    await a.run();
    await b.run();
    expect(transcript(a)).toEqual(transcript(b));
  });

  it("walks seeded feuds up the ladder and reconciles both sides", async () => {
    const sim = makeSim({ days: 5 });
    await sim.run();
    const reconciled = sim.world.transitions.filter((t) => t.transition.to === "reconciled");
    expect(reconciled.length).toBeGreaterThan(0);
    // Ladder transitions produce ladder posts.
    const formats = new Set([...sim.world.posts.values()].map((p) => p.format));
    expect(formats.has("public_exit") || formats.has("reconciliation")).toBe(true);
  });

  it("CR-7: an exhausted budget stops generation but bots keep reacting", async () => {
    const sim = makeSim({ config: { budget: { dailyLlmBudgetUsd: 0 } } });
    await sim.run();
    expect(sim.world.posts.size).toBe(0);
    expect(sim.stats.calls.filter((c) => c.callType === "post")).toHaveLength(0);
  });

  it("retries a failed call once, then drops the action", async () => {
    let n = 0;
    const flaky: FakeResponder = (req) => {
      if (req.callType === "comment") throw new Error("always fails");
      if (req.callType === "post" && n++ % 2 === 0) return { nope: true };
      return fakeResponder(req);
    };
    const sim = makeSim({ responder: flaky, days: 1 });
    await sim.run();
    expect(sim.world.comments.size).toBe(0);
    expect(sim.stats.rejections.llm_failure).toBeGreaterThan(0);
    expect(sim.stats.rejections.envelope).toBeGreaterThan(0);
    expect(sim.world.posts.size).toBeGreaterThan(0);
    expect(sim.stats.droppedActions).toBeGreaterThan(0);
  });

  it("drops posts the judge finds unsafe, and keeps an unscored post if the judge fails", async () => {
    const unsafe = makeSim({
      days: 1,
      responder: (req) => {
        if (req.callType !== "judge") return fakeResponder(req);
        const n = (req.prompt.user.match(/<candidate index=/g) ?? []).length;
        return {
          scores: Array.from({ length: n }, (_, index) => ({
            index,
            funny: 5,
            in_voice: 5,
            specific: 5,
            safe: 1,
            note: "",
          })),
        };
      },
    });
    await unsafe.run();
    expect(unsafe.world.posts.size).toBe(0);
    expect(unsafe.stats.rejections.judge_unsafe).toBeGreaterThan(0);

    const broken = makeSim({
      days: 1,
      responder: (req) => (req.callType === "judge" ? { garbage: 1 } : fakeResponder(req)),
    });
    await broken.run();
    expect(broken.world.posts.size).toBeGreaterThan(0);
    expect([...broken.world.posts.values()].every((p) => p.judge === undefined)).toBe(true);
  });

  it("drops actions whose prompt can't fit the token budget", async () => {
    const sim = makeSim({ days: 1, config: { llm: { maxInputTokens: 1500 } } });
    await sim.run();
    expect(sim.stats.rejections.budget).toBeGreaterThan(0);
  });
});

describe("spend cap", () => {
  it("stops between ticks once actual spend reaches maxUsd", async () => {
    const config = loadConfig();
    const random = seededRandom(1);
    const sim = new Simulation(
      content,
      config,
      new FakeLLMClient(fakeResponder, config.llm),
      new InMemorySpendLedger(),
      random,
      {
        personaIds: selectPersonas(content, 6, random),
        days: 3,
        start: START,
        transport: "realtime",
        concurrency: 4,
        maxUsd: 0.001,
      },
    );
    const { stoppedEarly } = await sim.run();
    expect(stoppedEarly).toBe(true);
    expect(sim.stoppedAt?.day).toBe(0);
    expect(sim.spentUsd()).toBeGreaterThanOrEqual(0.001);
    expect(sim.spentUsd()).toBeLessThan(0.01);
    expect(sim.daysSimulated()).toBeGreaterThan(0);
    expect(sim.daysSimulated()).toBeLessThan(1);
    expect(transcript(sim)).toContain("Stopped early at the spend cap.");
  });

  it("runs to completion under the cap", async () => {
    expect((await makeSim({ days: 1 }).run()).stoppedEarly).toBe(false);
  });
});

describe("reports", () => {
  it("renders transcript, judge, cost and gate", async () => {
    const sim = makeSim({ days: 3 });
    await sim.run();
    const t = transcript(sim);
    expect(t).toContain("## Cast");
    expect(t).toContain("## Day 1");
    expect(t).toContain("📰 **World event:** Synergetix cracks down");
    expect(t).toContain("other candidates the judge passed over");
    expect(t).toMatch(/### Overnight/);
    expect(judgeReport(sim)).toContain("## By persona type");
    expect(judgeReport(sim)).toContain("What best-of-N buys");
    expect(costReport(sim)).toContain("| total |");
    const g = gate(sim);
    expect(g.checks).toHaveLength(5);
    expect(g.costPerPersonaDay).toBeGreaterThan(0);
    expect(gateMarkdown(sim, true)).toContain("FAKE mode");
    expect(gateMarkdown(sim, false)).not.toContain("FAKE mode");
  });

  it("handles an empty run", () => {
    const sim = makeSim({ days: 0 });
    expect(gate(sim).avgFunny).toBe(0);
    expect(costReport(sim)).toContain("| total | 0 |");
    expect(transcript(sim)).toContain("## Cast");
  });
});
