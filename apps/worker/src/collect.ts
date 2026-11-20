// /collect: poll open batches; for each one that has ended, claim it, record its spend, and
// finish each request. Posts take two rounds (ADR 0005): candidates come back from the tick
// batch, the judge picks one in a follow-up batch, and only then is the post written.
// A failed or malformed request is retried once in the next batch, then dropped.
import {
  buildJudgePrompt,
  JudgeOutputSchema,
  parseCommentOutput,
  parsePostOutput,
  selectBest,
} from "@humbled/comedy";
import { canComment, canPost } from "@humbled/domain";
import { estimateCostUsd, type LLMResult } from "@humbled/llm";
import type { WorkerDeps } from "./deps.ts";
import { tryBuild } from "./tick.ts";
import { rescore, Snapshot, toBatch, type RequestContext } from "./world.ts";

/** CR-3: a batch still running after 2 hours is logged, and not retried in real time. */
export const BATCH_SLA_MS = 2 * 60 * 60 * 1000;

export interface CollectReport {
  batchesCollected: number;
  /** Open batches past the CR-3 2-hour SLA (logged; never retried in real time). */
  overdue: number;
  posts: number;
  comments: number;
  summaries: number;
  judged: number;
  retried: number;
  dropped: number;
  followUpBatchId?: string;
}

export async function runCollect(deps: WorkerDeps): Promise<CollectReport> {
  const report: CollectReport = {
    batchesCollected: 0,
    overdue: 0,
    posts: 0,
    comments: 0,
    summaries: 0,
    judged: 0,
    retried: 0,
    dropped: 0,
  };
  const followUps: RequestContext[] = [];

  try {
    await collectEnded(deps, report, followUps);
  } catch (e) {
    // Follow-ups for batches already written must survive: keep them for the next run.
    await deps.repos.deferFollowUps(followUps);
    throw e;
  }

  followUps.push(...((await deps.repos.takeDeferredFollowUps()) as RequestContext[]));
  if (followUps.length > 0) {
    const { requests, byId } = toBatch(followUps);
    let providerId: string;
    try {
      providerId = await deps.llm.submitBatch(requests);
    } catch (e) {
      await deps.repos.deferFollowUps(followUps);
      deps.log("follow_ups_deferred", { count: followUps.length });
      throw e;
    }
    report.followUpBatchId = await deps.repos.createBatch(
      providerId,
      "tick",
      byId,
      deps.clock.now(),
    );
  }
  deps.log("collect", { ...report });
  return report;
}

/** Write every ended batch's results; follow-up requests go into `followUps`. */
async function collectEnded(
  deps: WorkerDeps,
  report: CollectReport,
  followUps: RequestContext[],
): Promise<void> {
  let world: Snapshot | undefined;
  const golden = deps.content.golden.map((g) => g.body);
  for (const batch of await deps.repos.openBatches()) {
    if (!(await deps.llm.batchEnded(batch.providerBatchId))) {
      const ageMs = deps.clock.now().getTime() - batch.submittedAt.getTime();
      if (ageMs > BATCH_SLA_MS) {
        report.overdue++;
        deps.log("batch_sla_exceeded", { batchId: batch.id, minutes: Math.round(ageMs / 60_000) });
      }
      continue;
    }
    // Fetch before claiming: if the API fails here nothing is claimed, and the next run (or
    // Pub/Sub's retry) collects the batch. Once claimed, only our own writes can fail.
    const results = await deps.llm.batchResults(batch.providerBatchId);
    const now = deps.clock.now();
    // Claim it: an overlapping /collect run skips a batch another run already took.
    if (!(await deps.repos.markBatch(batch.id, "collected", now))) continue;
    report.batchesCollected++;
    world ??= await Snapshot.load(deps);
    const contexts = batch.requests as Record<string, RequestContext>;
    for (const result of results) {
      const ctx = contexts[result.id];
      if (!ctx) continue;
      await recordSpend(deps, result, ctx, now);
      const outcome = await finish(deps, world, ctx, result, now, golden, report);
      if (outcome === "retry") {
        if (ctx.attempt === 0) {
          followUps.push({ ...ctx, attempt: 1 });
          report.retried++;
        } else {
          await drop(deps, ctx, report);
        }
      } else if (outcome !== undefined) {
        followUps.push(outcome);
      }
    }
  }
}

async function recordSpend(deps: WorkerDeps, r: LLMResult, ctx: RequestContext, at: Date) {
  if (!r.usage) return;
  const callType = ctx.stage === "post" ? "post" : ctx.stage;
  const model = deps.config.llm.models[callType];
  await deps.ledger.record({
    callType,
    model,
    transport: "batch",
    usage: r.usage,
    estCostUsd: estimateCostUsd(r.usage, model, "batch", deps.config.llm),
    at,
  });
}

async function drop(deps: WorkerDeps, ctx: RequestContext, report: CollectReport) {
  report.dropped++;
  if (ctx.stage !== "summary") await deps.repos.finishAction(ctx.key, "dropped");
}

/**
 * Finish one request. Returns a follow-up request (the judge round), "retry" for a failed or
 * malformed result, or undefined when the request is done (written or deliberately dropped).
 */
async function finish(
  deps: WorkerDeps,
  world: Snapshot,
  ctx: RequestContext,
  r: LLMResult,
  now: Date,
  golden: readonly string[],
  report: CollectReport,
): Promise<RequestContext | "retry" | undefined> {
  const { config, repos } = deps;
  if (!r.ok) return "retry";

  switch (ctx.stage) {
    case "post": {
      let accepted;
      try {
        accepted = parsePostOutput(r.json, {
          config: config.comedy,
          recentPosts: ctx.recentBodies,
          allowedCallbackIds: new Set(ctx.callbackIds),
          referenceTexts: golden,
        }).accepted;
      } catch {
        return "retry";
      }
      if (accepted.length === 0) return "retry";
      const persona = world.personas.get(ctx.action.personaId);
      const prompt = persona
        ? tryBuild(() =>
            buildJudgePrompt(deps.content, persona.type, ctx.action.format, accepted, config),
          )
        : undefined;
      // No judge possible: keep the first valid candidate unscored rather than lose the post.
      if (!prompt)
        return writePost(deps, ctx.key, ctx.action, accepted[0]!, undefined, now, report);
      return {
        stage: "judge",
        key: ctx.key,
        action: ctx.action,
        prompt,
        attempt: 0,
        candidates: accepted,
      };
    }

    case "judge": {
      let scores;
      try {
        scores = JudgeOutputSchema.parse(r.json).scores;
      } catch {
        return "retry";
      }
      report.judged++;
      const best = selectBest(scores, ctx.candidates.length, config.comedy.minSafeScore);
      if (!best) {
        // Every candidate scored unsafe: drop the post (ADR 0007).
        await drop(deps, ctx, report);
        return undefined;
      }
      return writePost(deps, ctx.key, ctx.action, ctx.candidates[best.index]!, best, now, report);
    }

    case "comment": {
      let body;
      try {
        body = parseCommentOutput(r.json, config.comedy);
      } catch {
        return "retry";
      }
      if (!body) return "retry";
      const a = ctx.action;
      const counts = await repos.dailyCounts(a.personaId, now);
      const [post] = await repos.postsById([a.postId]);
      if (!post || !canComment(counts, config.quotas)) {
        await drop(deps, ctx, report);
        return undefined;
      }
      const target = a.kind === "reply" ? a.parentAuthorId : a.postAuthorId;
      const grudge =
        a.kind === "comment"
          ? a.grudge
          : world.relationships.get(`${a.personaId}->${target}`)?.rel.stage === "comment_war";
      await repos.insertComment({
        postId: a.postId,
        personaId: a.personaId,
        body,
        depth: a.kind === "reply" ? a.depth : 1,
        createdAt: now,
        ...(a.kind === "reply" ? { parentId: a.parentCommentId } : {}),
      });
      await rescore(deps, a.postId);
      // FR-18: a "respectfully, I'd push back" stings; an ordinary comment warms.
      await world.trigger(
        deps,
        target,
        a.personaId,
        grudge ? "pushBackComment" : "receivedComment",
        now,
      );
      await repos.finishAction(ctx.key, "done");
      report.comments++;
      return undefined;
    }

    case "summary": {
      const s = (r.json as { summary?: unknown }).summary;
      if (typeof s !== "string" || !s.trim()) return "retry";
      await repos.setCareerSummary(ctx.personaId, s.trim());
      report.summaries++;
      return undefined;
    }
  }
}

async function writePost(
  deps: WorkerDeps,
  key: Extract<RequestContext, { stage: "post" }>["key"],
  action: Extract<RequestContext, { stage: "post" }>["action"],
  winner: { body: string; hashtags: string[]; callback_post_id: string | null },
  score: { funny: number; in_voice: number; specific: number; safe: number } | undefined,
  now: Date,
  report: CollectReport,
): Promise<undefined> {
  const counts = await deps.repos.dailyCounts(action.personaId, now);
  if (!canPost(counts, deps.config.quotas)) {
    report.dropped++;
    await deps.repos.finishAction(key, "dropped");
    return undefined;
  }
  const postId = await deps.repos.insertPost({
    personaId: action.personaId,
    format: action.format,
    body: winner.body,
    hashtags: winner.hashtags,
    createdAt: now,
    ...(action.worldEventId ? { eventId: action.worldEventId } : {}),
    ...(action.grudgeTargetId ? { grudgeTargetId: action.grudgeTargetId } : {}),
    ...(winner.callback_post_id ? { callbackPostId: winner.callback_post_id } : {}),
  });
  if (score) {
    const { funny, in_voice, specific, safe } = score;
    await deps.repos.setJudgeScore(postId, { funny, in_voice, specific, safe });
  }
  await rescore(deps, postId);
  await deps.repos.finishAction(key, "done");
  report.posts++;
  return undefined;
}
