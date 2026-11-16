import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PERSONA_TYPES, POST_FORMATS, TRIGGERED_FORMATS } from "@humbled/domain";
import { loadConfig } from "@humbled/config";
import { ContentError, DEFAULT_CONTENT_DIR, loadContent, toPlannerProfile } from "../src/index.ts";

const content = loadContent();

/**
 * Real brands/platforms that must never appear in prompts or examples (seed for SR-4).
 * Ordinary words that double as brand names ("meta", "apple") are left to the real checker,
 * which needs context.
 */
const BRAND_BLOCKLIST = [
  "linkedin",
  "wework",
  "slack",
  "courtyard",
  "tesla",
  "google",
  "microsoft",
  "amazon",
  "facebook",
  "instagram",
  "tiktok",
  "twitter",
  "openai",
  "chatgpt",
  "anthropic",
  "claude",
  "zoom",
  "salesforce",
  "starbucks",
  "uber",
  "airbnb",
  "nvidia",
  "netflix",
  "peloton",
];
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

describe("shipped content (PRD Phase 0 checklist)", () => {
  it("has all 8 persona type modules", () => {
    expect([...content.personaTypes.keys()].sort()).toEqual([...PERSONA_TYPES].sort());
  });

  it("has instructions for every post format", () => {
    expect(Object.keys(content.formats).sort()).toEqual([...POST_FORMATS].sort());
  });

  it("persona types only weight formats ordinary selection can pick, and have at least 4", () => {
    for (const mod of content.personaTypes.values()) {
      const formats = Object.entries(mod.format_weights)
        .filter(([, w]) => w > 0)
        .map(([f]) => f);
      expect(formats.length, mod.type).toBeGreaterThanOrEqual(4);
      for (const f of formats)
        expect(TRIGGERED_FORMATS.has(f as never), `${mod.type}: ${f}`).toBe(false);
    }
  });

  it("persona post rates land near 3 posts/day at a 15-minute tick", () => {
    for (const mod of content.personaTypes.values()) {
      const perDay = mod.action_rates.post * 96;
      expect(perDay, mod.type).toBeGreaterThanOrEqual(2);
      expect(perDay, mod.type).toBeLessThanOrEqual(4);
    }
  });

  it("has 20 companies, 30 events with one launch event, ~20 nudges", () => {
    expect(content.companies.length).toBeGreaterThanOrEqual(20);
    expect(content.events.length).toBeGreaterThanOrEqual(30);
    expect(content.events.filter((e) => e.launch).map((e) => e.id)).toEqual([
      "synergetix-pod-crackdown",
    ]);
    expect(content.nudges.length).toBeGreaterThanOrEqual(20);
  });

  it("golden candidates cover every type and respect post length (40 to 180 words)", () => {
    for (const t of PERSONA_TYPES) {
      expect(content.golden.filter((g) => g.type === t).length, t).toBeGreaterThanOrEqual(4);
    }
    for (const g of content.golden) {
      const n = words(g.body);
      expect(n, `${g.id}: ${n} words`).toBeGreaterThanOrEqual(40);
      expect(n, `${g.id}: ${n} words`).toBeLessThanOrEqual(180);
    }
  });

  it("golden candidates use only ordinary or explicitly-triggered formats sensibly", () => {
    for (const g of content.golden)
      expect(["vague_post", "public_exit", "reconciliation"]).not.toContain(g.format);
  });

  it("no real brands in any prompt-facing content", () => {
    const corpus = [
      ...[...content.personaTypes.values()].map((m) => JSON.stringify(m)),
      JSON.stringify(content.formats),
      JSON.stringify(content.companies),
      JSON.stringify(content.events),
      JSON.stringify(content.nudges),
      JSON.stringify(content.golden),
      JSON.stringify(content.houseBots),
      JSON.stringify(content.houseRelationships),
    ]
      .join("\n")
      .toLowerCase();
    for (const brand of BRAND_BLOCKLIST) {
      expect(corpus, brand).not.toMatch(new RegExp(`\\b${brand}\\b`));
    }
  });

  it("projects a type module to a planner profile", () => {
    const p = toPlannerProfile(content.personaTypes.get("hustle_bro")!);
    expect(p.type).toBe("hustle_bro");
    expect(p.actionRates.post).toBeGreaterThan(0);
    expect(p.formatWeights.lesson).toBeGreaterThan(0);
  });
});

describe("house bots (FR-6)", () => {
  const thresholds = loadConfig().grudge.thresholds;
  const threshold: Record<string, number> = {
    cold: thresholds.cold,
    vague_posting: thresholds.vaguePosting,
    comment_war: thresholds.commentWar,
    public_exit: thresholds.publicExit,
  };

  it("has 30 to 50 house bots, at least 3 of every type", () => {
    expect(content.houseBots.length).toBeGreaterThanOrEqual(30);
    expect(content.houseBots.length).toBeLessThanOrEqual(50);
    for (const t of PERSONA_TYPES) {
      expect(content.houseBots.filter((b) => b.type === t).length, t).toBeGreaterThanOrEqual(3);
    }
  });

  it("seeded stages are consistent with affinity thresholds", () => {
    for (const r of content.houseRelationships) {
      for (const side of [r.a_to_b, r.b_to_a]) {
        const t = threshold[side.stage];
        if (t !== undefined)
          expect(side.affinity, `${r.a}/${r.b} ${side.stage}`).toBeLessThanOrEqual(t);
        if (side.stage === "neutral")
          expect(side.affinity, `${r.a}/${r.b}`).toBeGreaterThan(thresholds.cold);
      }
    }
  });

  it("seeds at least one feud close enough to reconcile within a 7-day simulation", () => {
    const late = content.houseRelationships.filter((r) =>
      [r.a_to_b, r.b_to_a].some(
        (s) => s.stage === "public_exit" || (s.stage === "comment_war" && s.days_in_stage >= 2),
      ),
    );
    expect(late.length).toBeGreaterThanOrEqual(1);
  });

  it("seeds pods (positive relationships) too", () => {
    expect(
      content.houseRelationships.filter((r) => r.a_to_b.affinity >= 0.5 && r.b_to_a.affinity >= 0.5)
        .length,
    ).toBeGreaterThanOrEqual(3);
  });
});

describe("golden anchors", () => {
  it("has the laugh-out-loud anchors, each with a reason", () => {
    const anchors = content.golden.filter((g) => g.anchor);
    expect(anchors.map((g) => g.id).sort()).toEqual(["gl-04", "pf-03", "pf-06", "rc-02", "rc-04"]);
    for (const a of anchors) expect(a.approved && a.why).toBeTruthy();
  });
});

describe("loader validation", () => {
  const fixture = () => {
    const dir = mkdtempSync(join(tmpdir(), "humbled-content-"));
    cpSync(DEFAULT_CONTENT_DIR, dir, { recursive: true });
    return dir;
  };
  const edit = (dir: string, rel: string, fn: (s: string) => string) => {
    const p = join(dir, rel);
    writeFileSync(p, fn(readFileSync(p, "utf8")));
  };

  it("rejects schema violations with the file and path", () => {
    const dir = fixture();
    edit(dir, "personas/recruiter.yaml", (s) => s.replace("post: 0.03,", "post: 3,"));
    expect(() => loadContent(dir)).toThrow(/recruiter\.yaml: action_rates\.post/);
  });

  it("rejects a type that doesn't match its file name", () => {
    const dir = fixture();
    edit(dir, "personas/recruiter.yaml", (s) => s.replace("type: recruiter", "type: hustle_bro"));
    expect(() => loadContent(dir)).toThrow(ContentError);
  });

  it("rejects duplicate ids", () => {
    const dir = fixture();
    edit(dir, "world/nudges.yaml", (s) => s + '- { id: laid_off, label: "again" }\n');
    expect(() => loadContent(dir)).toThrow(/duplicate nudge id: laid_off/);
  });

  it("rejects an anchor that isn't approved", () => {
    const dir = fixture();
    edit(dir, "eval/golden/candidates.yaml", (s) =>
      s.replace(
        "- id: hb-01\n  type: hustle_bro\n  format: lesson\n  approved: false\n",
        "- id: hb-01\n  type: hustle_bro\n  format: lesson\n  approved: false\n  anchor: true\n  why: nope\n",
      ),
    );
    expect(() => loadContent(dir)).toThrow(/anchor must be approved/);
  });

  it("rejects relationships with unknown bots", () => {
    const dir = fixture();
    edit(dir, "house/relationships.yaml", (s) => s.replace("a: doug-kessler", "a: nobody-at-all"));
    expect(() => loadContent(dir)).toThrow(/unknown bot: nobody-at-all/);
  });

  it("rejects more than one launch event", () => {
    const dir = fixture();
    edit(dir, "world/events.yaml", (s) =>
      s.replace("- id: layoffs-quick-sync", "- id: layoffs-quick-sync\n  launch: true"),
    );
    expect(() => loadContent(dir)).toThrow(/launch/);
  });
});
