import type { Config } from "@humbled/config";
import { selectFormat } from "./formats.ts";
import { chance, pickOne, weightedPick, type Random } from "./ports.ts";
import { canComment, canPost, canReplyAtDepth, replyCooldownOk } from "./quotas.ts";
import type {
  CommentRef,
  DailyCounts,
  FeedItem,
  PersonaId,
  PersonaState,
  PersonaTypeProfile,
  PlannedAction,
  PostFormat,
  PostId,
  Relationship,
} from "./types.ts";

/**
 * Everything the planner needs about one persona for one tick. Assembled by the worker
 * (or the simulation harness) from repositories; the planner itself does no I/O.
 */
export interface PlanInput {
  persona: PersonaState;
  profile: PersonaTypeProfile;
  counts: DailyCounts;
  /** dormancy multiplier x budget multiplier, computed by the caller. */
  activityMultiplier: number;
  /** False when the daily budget is exhausted: only code-only actions are planned. */
  generationAllowed: boolean;
  worldEvent?: { id: string; alreadyReacted: boolean };
  /** Relationships *from* this persona. */
  relationships: readonly Relationship[];
  /** Feed sample (already reach-weighted). May include the persona's own posts. */
  feed: readonly FeedItem[];
  /** Newest first. */
  recentFormats: readonly PostFormat[];
  /** Comments by others on this persona's posts, or replies to this persona's comments. */
  replyCandidates: readonly CommentRef[];
  lastRepliedAt: ReadonlyMap<PersonaId, Date>;
  following: ReadonlySet<PersonaId>;
  endorsed: ReadonlySet<PersonaId>;
  /**
   * Posts this persona has already left a top-level comment on. The planner won't pick them
   * again: one top-level comment per post, like a person. Back-and-forth goes through replies.
   */
  commentedPostIds: ReadonlySet<PostId>;
  now: Date;
}

export function planTick(input: PlanInput, random: Random, config: Config): PlannedAction[] {
  const { persona, profile } = input;
  const m = config.planner.frequencyMultipliers[persona.frequency] * input.activityMultiplier;
  if (m <= 0) return [];

  const rates = profile.actionRates;
  const actions: PlannedAction[] = [];
  const relByTarget = new Map(input.relationships.map((r) => [r.to, r]));
  const stageOf = (id: PersonaId) => relByTarget.get(id)?.stage ?? "neutral";
  // Cold and beyond: stop reacting to the rival (invisible, but the data changes).
  const ignoring = (id: PersonaId) => stageOf(id) !== "neutral" && stageOf(id) !== "reconciled";
  const othersFeed = input.feed.filter((f) => f.authorId !== persona.id);

  if (input.generationAllowed) {
    const post = planPost(input, random, config, m);
    if (post) actions.push(post);

    const comment = planComment(input, random, config, m, othersFeed);
    if (comment) actions.push(comment);

    const reply = planReply(input, random, config, m, comment ? 1 : 0);
    if (reply) actions.push(reply);
  }

  if (chance(random, Math.min(1, rates.react * m))) {
    const target = pickOne(
      random,
      othersFeed.filter((f) => !ignoring(f.authorId)),
    );
    const reaction = weightedPick(random, profile.reactionWeights);
    if (target && reaction) {
      actions.push({ kind: "react", personaId: persona.id, postId: target.postId, reaction });
    }
  }

  if (chance(random, Math.min(1, rates.follow * m))) {
    const authors = [...new Set(othersFeed.map((f) => f.authorId))].filter(
      (a) => !input.following.has(a) && !ignoring(a),
    );
    const target = pickOne(random, authors);
    if (target) actions.push({ kind: "follow", personaId: persona.id, targetId: target });
  }

  if (chance(random, Math.min(1, rates.endorse * m))) {
    const target = pickOne(
      random,
      [...input.following].filter((f) => !input.endorsed.has(f) && !ignoring(f)),
    );
    if (target) actions.push({ kind: "endorse", personaId: persona.id, targetId: target });
  }

  return actions;
}

function planPost(
  input: PlanInput,
  random: Random,
  config: Config,
  m: number,
): PlannedAction | undefined {
  const { persona, profile, worldEvent } = input;
  if (!canPost(input.counts, config.quotas)) return undefined;

  const eventPending = worldEvent !== undefined && !worldEvent.alreadyReacted;
  const boost = eventPending ? config.planner.eventDayPostBoost : 1;
  if (!chance(random, Math.min(1, profile.actionRates.post * m * boost))) return undefined;

  if (eventPending && chance(random, config.planner.eventReactionShare)) {
    return {
      kind: "post",
      personaId: persona.id,
      format: "event_reaction",
      worldEventId: worldEvent.id,
    };
  }

  const feuds = input.relationships.filter((r) => r.stage !== "neutral" && r.stage !== "cold");
  const grudgy = feuds.length > 0 && chance(random, config.comedy.grudgeOrCallbackShare);
  const vagueTargets = feuds.filter((r) => r.stage === "vague_posting");

  // Stage 2 posts are vague-posts, and only stage 2 may vague-post.
  if (
    grudgy &&
    vagueTargets.length > 0 &&
    !input.recentFormats.slice(0, 1).includes("vague_post")
  ) {
    const target = pickOne(random, vagueTargets)!;
    return { kind: "post", personaId: persona.id, format: "vague_post", grudgeTargetId: target.to };
  }

  const format = selectFormat(
    random,
    profile.formatWeights,
    input.recentFormats,
    config.comedy.formatNoRepeatWindow,
  );
  if (!format) return undefined;
  const action: PlannedAction = { kind: "post", personaId: persona.id, format };
  if (grudgy) action.grudgeTargetId = pickOne(random, feuds)!.to;
  return action;
}

function planComment(
  input: PlanInput,
  random: Random,
  config: Config,
  m: number,
  feed: readonly FeedItem[],
): PlannedAction | undefined {
  const { persona, profile } = input;
  if (!canComment(input.counts, config.quotas)) return undefined;
  if (!chance(random, Math.min(1, profile.actionRates.comment * m))) return undefined;
  const othersFeed = feed.filter((f) => !input.commentedPostIds.has(f.postId));

  const stageOf = (id: PersonaId) =>
    input.relationships.find((r) => r.to === id)?.stage ?? "neutral";
  // Comment wars happen on the rival's posts; prefer them when one is in the sample.
  const warTargets = othersFeed.filter((f) => stageOf(f.authorId) === "comment_war");
  if (warTargets.length > 0 && chance(random, config.comedy.grudgeOrCallbackShare * 2)) {
    const t = pickOne(random, warTargets)!;
    return {
      kind: "comment",
      personaId: persona.id,
      postId: t.postId,
      postAuthorId: t.authorId,
      grudge: true,
    };
  }
  const peaceful = othersFeed.filter((f) => {
    const s = stageOf(f.authorId);
    return s === "neutral" || s === "reconciled";
  });
  const t = pickOne(random, peaceful);
  if (!t) return undefined;
  return {
    kind: "comment",
    personaId: persona.id,
    postId: t.postId,
    postAuthorId: t.authorId,
    grudge: false,
  };
}

function planReply(
  input: PlanInput,
  random: Random,
  config: Config,
  m: number,
  commentsPlannedThisTick: number,
): PlannedAction | undefined {
  const { persona, profile } = input;
  const counts = { ...input.counts, comments: input.counts.comments + commentsPlannedThisTick };
  if (!canComment(counts, config.quotas)) return undefined;
  if (!chance(random, Math.min(1, profile.actionRates.reply * m))) return undefined;

  const eligible = input.replyCandidates.filter(
    (c) =>
      c.authorId !== persona.id &&
      canReplyAtDepth(c.depth, config.quotas) &&
      replyCooldownOk(c.authorId, input.lastRepliedAt, input.now, config.quotas),
  );
  const c = pickOne(random, eligible);
  if (!c) return undefined;
  return {
    kind: "reply",
    personaId: persona.id,
    postId: c.postId,
    parentCommentId: c.commentId,
    parentAuthorId: c.authorId,
    depth: c.depth + 1,
  };
}
