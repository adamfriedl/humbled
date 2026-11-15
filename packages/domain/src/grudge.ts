import type { Config } from "@humbled/config";
import { chance, daysBetween, type Random } from "./ports.ts";
import type { Relationship, RelationshipStage } from "./types.ts";

type GrudgeConfig = Config["grudge"];

export type RelationshipTrigger = keyof GrudgeConfig["triggerDeltas"];

export interface StageTransition {
  from: RelationshipStage;
  to: RelationshipStage;
}

/** Stages in which grudge content is allowed, and what kind (PRD escalation ladder). */
export const GRUDGE_CONTENT: Record<
  RelationshipStage,
  "none" | "silent" | "vague_post" | "comment_war" | "exit_post" | "reconciliation_post"
> = {
  neutral: "none",
  cold: "silent",
  vague_posting: "vague_post",
  comment_war: "comment_war",
  public_exit: "exit_post",
  reconciled: "reconciliation_post",
};

const ESCALATION: Partial<
  Record<
    RelationshipStage,
    { next: RelationshipStage; threshold: keyof GrudgeConfig["thresholds"] }
  >
> = {
  neutral: { next: "cold", threshold: "cold" },
  reconciled: { next: "cold", threshold: "cold" },
  cold: { next: "vague_posting", threshold: "vaguePosting" },
  vague_posting: { next: "comment_war", threshold: "commentWar" },
  comment_war: { next: "public_exit", threshold: "publicExit" },
};

export function clampAffinity(a: number): number {
  return Math.max(-1, Math.min(1, a));
}

export function newRelationship(from: string, to: string, now: Date, affinity = 0): Relationship {
  return {
    from,
    to,
    affinity: clampAffinity(affinity),
    stage: "neutral",
    stageSince: now,
    notes: [],
  };
}

/** Apply a trigger's affinity delta (FR-18). Optionally append the LLM-written note. */
export function applyTrigger(
  rel: Relationship,
  trigger: RelationshipTrigger,
  cfg: GrudgeConfig,
  note?: string,
): Relationship {
  return {
    ...rel,
    affinity: clampAffinity(rel.affinity + cfg.triggerDeltas[trigger]),
    notes: note ? [...rel.notes, note] : rel.notes,
  };
}

/** True if the rival's similar post beat ours by enough to start (or feed) a grudge. */
export function isSimilarTakeOutperformed(
  cosine: number,
  ourEngagement: number,
  theirEngagement: number,
  cfg: GrudgeConfig,
): boolean {
  return (
    cosine > cfg.similarTakeCosine &&
    theirEngagement > Math.max(ourEngagement, 1) * cfg.outperformFactor
  );
}

function withStage(rel: Relationship, stage: RelationshipStage, now: Date): Relationship {
  return { ...rel, stage, stageSince: now };
}

/**
 * Advance one relationship by one simulated day (called from the nightly job).
 * At most one stage transition per call, so feuds take at least minDwellDays per rung.
 */
export function advanceDaily(
  rel: Relationship,
  now: Date,
  random: Random,
  cfg: GrudgeConfig,
): { relationship: Relationship; transition?: StageTransition } {
  const dwell = daysBetween(rel.stageSince, now);
  const dwellMet = dwell >= cfg.minDwellDays;
  let current = rel;

  if (current.stage === "vague_posting" || current.stage === "comment_war") {
    current = { ...current, affinity: clampAffinity(current.affinity - cfg.feudDriftPerDay) };
  }

  // Cold can thaw quietly at any time: nobody noticed it anyway.
  if (current.stage === "cold" && current.affinity > cfg.thawAbove) {
    return {
      relationship: withStage(current, "neutral", now),
      transition: { from: "cold", to: "neutral" },
    };
  }

  if (current.stage === "public_exit") {
    if (!dwellMet) return { relationship: current };
    const extraDays = Math.floor(dwell - cfg.minDwellDays);
    const p = Math.min(
      1,
      cfg.reconciliationBaseDailyProbability + extraDays * cfg.reconciliationDailyIncrement,
    );
    if (chance(random, p)) {
      return {
        relationship: {
          ...withStage(current, "reconciled", now),
          affinity: cfg.reconciledAffinity,
        },
        transition: { from: "public_exit", to: "reconciled" },
      };
    }
    return { relationship: current };
  }

  // Neutral needs no dwell to go cold; reconciled and the feud stages do.
  const needsDwell = current.stage !== "neutral";
  const step = ESCALATION[current.stage];
  if (step && (!needsDwell || dwellMet) && current.affinity <= cfg.thresholds[step.threshold]) {
    return {
      relationship: withStage(current, step.next, now),
      transition: { from: current.stage, to: step.next },
    };
  }

  // Reconciled settles back into neutral once the glow wears off.
  if (current.stage === "reconciled" && dwellMet) {
    return {
      relationship: withStage(current, "neutral", now),
      transition: { from: "reconciled", to: "neutral" },
    };
  }

  return { relationship: current };
}

/** Strongest relationships for prompt assembly (FR-20): most extreme affinity first, active feuds before neutral. */
export function strongestRelationships(rels: readonly Relationship[], n: number): Relationship[] {
  const stageRank = (s: RelationshipStage) => (s === "neutral" ? 0 : 1);
  return [...rels]
    .sort(
      (a, b) =>
        stageRank(b.stage) - stageRank(a.stage) || Math.abs(b.affinity) - Math.abs(a.affinity),
    )
    .slice(0, n);
}

/**
 * Ladder transitions that produce a post: the public exit and the reconciliation payoff.
 * The nightly job turns these into generation actions.
 */
export function transitionPostFormat(
  t: StageTransition,
): "public_exit" | "reconciliation" | undefined {
  if (t.to === "public_exit") return "public_exit";
  if (t.to === "reconciled") return "reconciliation";
  return undefined;
}

/**
 * Coffee takes two. When `from` reconciles with `to`, the reverse relationship reconciles too if
 * it's still a visible feud (vague-posting or worse); a cold or friendly reverse side is left
 * alone. Returns the updated reverse relationship and whether it changed.
 */
export function mirrorReconciliation(
  reverse: Relationship,
  now: Date,
  cfg: GrudgeConfig,
): { relationship: Relationship; transition?: StageTransition } {
  const visibleFeud =
    reverse.stage === "vague_posting" ||
    reverse.stage === "comment_war" ||
    reverse.stage === "public_exit";
  if (!visibleFeud) return { relationship: reverse };
  return {
    relationship: {
      ...reverse,
      stage: "reconciled",
      stageSince: now,
      affinity: cfg.reconciledAffinity,
    },
    transition: { from: reverse.stage, to: "reconciled" },
  };
}
