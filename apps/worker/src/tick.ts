// /tick (PRD "Tick flow"): budget check, plan every active persona, apply code-only actions
// now, and submit every generation as one Message Batch. Idempotent per tick id: a redelivered
// tick plans the same actions (the random seed is the tick id) and every claim fails.
import {
  buildCommentPrompt,
  buildPostPrompt,
  PromptBudgetError,
  type BuiltPrompt,
  type PostTask,
} from "@humbled/comedy";
import { toPlannerProfile } from "@humbled/content";
import type { ActionKey } from "@humbled/db";
import {
  budgetDecision,
  chance,
  dormancyMultiplier,
  MS_PER_DAY,
  MS_PER_MINUTE,
  pickOne,
  planTick,
  sampleFeed,
  seededRandom,
  type PersonaState,
  type PlannedAction,
  type Random,
} from "@humbled/domain";
import { dayKey } from "@humbled/llm";
import type { WorkerDeps } from "./deps.ts";
import { rescore, Snapshot, toBatch, type RequestContext } from "./world.ts";

export interface TickReport {
  tickId: string;
  mode: string;
  planned: number;
  claimed: number;
  codeOnly: number;
  submitted: number;
  dropped: number;
  batchId?: string;
  skipped?: "already_ran";
}

/** Ticks are aligned to the tick interval; the id is the tick's start time. */
export function tickStart(at: Date, intervalMinutes: number): Date {
  const ms = intervalMinutes * MS_PER_MINUTE;
  return new Date(Math.floor(at.getTime() / ms) * ms);
}

/** A stable 32-bit seed from the tick id, so a redelivered tick replans identically. */
export function seedFor(tickId: string): number {
  let h = 2166136261;
  for (let i = 0; i < tickId.length; i++) h = Math.imul(h ^ tickId.charCodeAt(i), 16777619);
  return h >>> 0;
}

export async function runTick(deps: WorkerDeps, at: Date): Promise<TickReport> {
  const { repos, config } = deps;
  const now = tickStart(at, config.tick.intervalMinutes);
  const tickId = now.toISOString();
  const random = seededRandom(seedFor(tickId));
  const spent = await deps.ledger.spentOn(dayKey(now), "batch");
  const budget = budgetDecision(spent, config.budget);
  const report: TickReport = {
    tickId,
    mode: budget.mode,
    planned: 0,
    claimed: 0,
    codeOnly: 0,
    submitted: 0,
    dropped: 0,
  };
  // A redelivery of a tick that already ran is a no-op. (Re-planning it isn't: the first run
  // changed the state the planner reads, so it could plan new action types.)
  if (!(await repos.claimJobRun("tick", tickId))) {
    deps.log("tick", { ...report, skipped: "already_ran" });
    return { ...report, skipped: "already_ran" };
  }
  const keys: ActionKey[] = [];
  try {
    await planAndSubmit(deps, now, tickId, random, budget, report, keys);
  } catch (e) {
    // Let Pub/Sub's retry run the tick again: release the tick and the generation actions that
    // never reached a batch. Code-only actions already written keep their claims.
    await repos.releaseActions(keys);
    await repos.releaseJobRun("tick", tickId);
    throw e;
  }
  deps.log("tick", { ...report });
  return report;
}

async function planAndSubmit(
  deps: WorkerDeps,
  now: Date,
  tickId: string,
  random: Random,
  budget: ReturnType<typeof budgetDecision>,
  report: TickReport,
  keys: ActionKey[],
): Promise<void> {
  const { repos, config, content } = deps;
  const world = await Snapshot.load(deps);
  const event = await repos.eventOn(dayKey(now));
  const feedPool = await repos.feedSince(new Date(now.getTime() - 2 * MS_PER_DAY));
  const touched = new Set<string>();
  const contexts: RequestContext[] = [];

  for (const p of world.personas.values()) {
    const mod = content.personaTypes.get(p.type);
    if (!mod) continue;
    const state: PersonaState = {
      id: p.id,
      type: p.type,
      isHouse: p.isHouse,
      frequency: p.frequency,
      ...(p.ownerLastSeenAt ? { ownerLastSeenAt: p.ownerLastSeenAt } : {}),
    };
    const activity =
      dormancyMultiplier(state, now, config.dormancy) *
      budget.activityMultiplier *
      p.activityMultiplier;
    if (activity <= 0) continue;

    const counts = await repos.dailyCounts(p.id, now);
    const feed = sampleFeed(
      feedPool,
      config.planner.feedSampleSize,
      now,
      random,
      config.engagement,
    );
    const actions = planTick(
      {
        persona: state,
        profile: toPlannerProfile(mod),
        counts,
        activityMultiplier: activity,
        generationAllowed: budget.mode !== "generation_paused",
        ...(event
          ? {
              worldEvent: {
                id: event.id,
                alreadyReacted: await repos.postedFormatOn(p.id, "event_reaction", now),
              },
            }
          : {}),
        relationships: world.relationshipsFrom(p.id),
        feed,
        recentFormats: (await repos.recentPostsBy(p.id, config.comedy.formatNoRepeatWindow)).map(
          (x) => x.format,
        ),
        replyCandidates: await repos.replyCandidates(p.id, new Date(now.getTime() - MS_PER_DAY)),
        lastRepliedAt: await repos.lastRepliedAt(p.id),
        following: await repos.following(p.id),
        endorsed: await repos.endorsed(p.id),
        commentedPostIds: await repos.commentedPostIds(
          p.id,
          new Date(now.getTime() - 2 * MS_PER_DAY),
        ),
        now,
      },
      random,
      config,
    );

    // A ladder post owed from last night replaces a planned post, after 08:00 (quota permitting).
    const owed = p.pendingPosts[0];
    if (
      owed &&
      budget.mode !== "generation_paused" &&
      counts.posts < config.quotas.postsPerDay &&
      now.getUTCHours() >= 8
    ) {
      const ladder: PlannedAction = {
        kind: "post",
        personaId: p.id,
        format: owed.format,
        grudgeTargetId: owed.targetId,
      };
      const i = actions.findIndex((a) => a.kind === "post");
      if (i >= 0) actions[i] = ladder;
      else actions.unshift(ladder);
      await repos.setPendingPosts(p.id, p.pendingPosts.slice(1));
    }

    report.planned += actions.length;
    for (const action of actions) {
      const key: ActionKey = { tickId, personaId: p.id, actionType: action.kind };
      if (!(await repos.claimAction(key, action))) continue;
      report.claimed++;
      const ctx = await applyOrPrepare(deps, world, action, key, now, random, feed, event);
      if (ctx === "done") {
        report.codeOnly++;
        await repos.finishAction(key, "done");
        if (action.kind === "react") touched.add(action.postId);
      } else if (ctx === undefined) {
        report.dropped++;
        await repos.finishAction(key, "dropped");
      } else {
        contexts.push(ctx);
        keys.push(key);
      }
    }
  }

  for (const postId of touched) await rescore(deps, postId);

  if (contexts.length > 0) {
    const { requests, byId } = toBatch(contexts);
    const providerId = await deps.llm.submitBatch(requests);
    const batchId = await repos.createBatch(providerId, "tick", byId);
    await repos.attachBatch(keys, batchId);
    report.submitted = requests.length;
    report.batchId = batchId;
  }
}

/** Code-only actions are written now ("done"); generative ones become batch requests. */
async function applyOrPrepare(
  deps: WorkerDeps,
  world: Snapshot,
  action: PlannedAction,
  key: ActionKey,
  now: Date,
  random: Random,
  feed: readonly { postId: string }[],
  event: { id: string; headline: string; body: string } | undefined,
): Promise<RequestContext | "done" | undefined> {
  const { repos } = deps;
  switch (action.kind) {
    case "react": {
      const [post] = await repos.postsById([action.postId]);
      if (!post) return undefined;
      if (await repos.react(post.id, action.personaId, action.reaction, now)) {
        await world.trigger(
          deps,
          post.personaId,
          action.personaId,
          "receivedPositiveReaction",
          now,
        );
      }
      return "done";
    }
    case "follow":
      await repos.follow(action.personaId, action.targetId);
      return "done";
    case "endorse": {
      const target = world.personas.get(action.targetId);
      const skills = target ? deps.content.personaTypes.get(target.type)?.skills : undefined;
      const skill = pickOne(random, skills ?? []) ?? "Leadership";
      await repos.endorse(action.personaId, action.targetId, skill);
      return "done";
    }
    case "post":
      return preparePost(deps, world, action, key, now, random, feed, event);
    case "comment":
    case "reply":
      return prepareComment(deps, world, action, key);
  }
}

async function preparePost(
  deps: WorkerDeps,
  world: Snapshot,
  action: Extract<PlannedAction, { kind: "post" }>,
  key: ActionKey,
  now: Date,
  random: Random,
  feed: readonly { postId: string }[],
  event: { id: string; headline: string; body: string } | undefined,
): Promise<RequestContext | undefined> {
  const { config, repos } = deps;
  const task: PostTask = { format: action.format };
  if (action.format === "event_reaction" && event) {
    task.worldEvent = { headline: event.headline, body: event.body };
    action.worldEventId = event.id;
  }
  if (action.grudgeTargetId) {
    const ctx = world.context(action.personaId, action.grudgeTargetId);
    if (ctx) task.grudgeTarget = ctx;
  }
  // FR-20: at most one callback: the persona's best earlier post (before today), sometimes.
  const recent = await repos.recentPostsBy(action.personaId, 20);
  const today = dayKey(now);
  const best = recent
    .filter((x) => dayKey(x.createdAt) < today)
    .sort((a, b) => b.engagementScore - a.engagementScore)[0];
  if (best && !task.grudgeTarget && chance(random, config.comedy.grudgeOrCallbackShare)) {
    task.callback = { postId: best.id, body: best.body };
  }
  const ctx = await world.generationContext(
    deps,
    action.personaId,
    feed.map((f) => f.postId),
  );
  const prompt = tryBuild(() => buildPostPrompt(deps.content, ctx, task, random, config));
  if (!prompt) return undefined;
  return {
    stage: "post",
    key,
    action,
    prompt,
    attempt: 0,
    recentBodies: recent.slice(0, config.comedy.repetitionWindow).map((x) => x.body),
    callbackIds: task.callback ? [task.callback.postId] : [],
  };
}

async function prepareComment(
  deps: WorkerDeps,
  world: Snapshot,
  action: Extract<PlannedAction, { kind: "comment" | "reply" }>,
  key: ActionKey,
): Promise<RequestContext | undefined> {
  const [post] = await deps.repos.postsById([action.postId]);
  if (!post) return undefined;
  const target = action.kind === "reply" ? action.parentAuthorId : action.postAuthorId;
  const [parent] =
    action.kind === "reply" ? await deps.repos.commentsById([action.parentCommentId]) : [];
  if (action.kind === "reply" && !parent) return undefined;
  const relationship = world.context(action.personaId, target);
  const ctx = await world.generationContext(deps, action.personaId, []);
  const prompt = tryBuild(() =>
    buildCommentPrompt(
      deps.content,
      ctx,
      {
        post: { postId: post.id, authorName: world.name(post.personaId), body: post.body },
        ...(parent
          ? { parent: { authorName: world.name(parent.personaId), body: parent.body } }
          : {}),
        ...(relationship ? { relationship } : {}),
      },
      deps.config,
    ),
  );
  if (!prompt) return undefined;
  return { stage: "comment", key, action, prompt, attempt: 0 };
}

/** A prompt that can't fit the token budget drops the action (CR-4). */
export function tryBuild(build: () => BuiltPrompt): BuiltPrompt | undefined {
  try {
    return build();
  } catch (e) {
    if (e instanceof PromptBudgetError) return undefined;
    throw e;
  }
}
