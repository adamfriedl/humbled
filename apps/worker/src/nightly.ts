// /nightly (03:00 Pacific): advance every relationship one day on the escalation ladder,
// queue owed ladder posts, and submit career summaries (FR-17) as one batch. Runs once per UTC
// day: the day that has just ended. Claimed first, so a Pub/Sub redelivery is a no-op.
import { buildSummaryPrompt } from "@humbled/comedy";
import type { PendingPost } from "@humbled/db";
import {
  advanceDaily,
  mirrorReconciliation,
  MS_PER_DAY,
  seededRandom,
  transitionPostFormat,
} from "@humbled/domain";
import { dayKey } from "@humbled/llm";
import { personaCard, type WorkerDeps } from "./deps.ts";
import { seedFor, tryBuild } from "./tick.ts";
import { relKey, Snapshot, toBatch, type RequestContext } from "./world.ts";

export interface NightlyReport {
  day: string;
  skipped?: "already_ran";
  transitions: number;
  ladderPostsQueued: number;
  summariesSubmitted: number;
  batchId?: string;
}

export async function runNightly(deps: WorkerDeps, at: Date): Promise<NightlyReport> {
  const { repos, config } = deps;
  // The UTC day that has just ended, and the moment it ended.
  const dayEnd = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const day = dayKey(new Date(dayEnd.getTime() - MS_PER_DAY));
  const report: NightlyReport = {
    day,
    transitions: 0,
    ladderPostsQueued: 0,
    summariesSubmitted: 0,
  };
  if (!(await repos.claimJobRun("nightly", day))) {
    deps.log("nightly", { ...report, skipped: "already_ran" });
    return { ...report, skipped: "already_ran" };
  }

  const random = seededRandom(seedFor(`nightly:${day}`));
  const world = await Snapshot.load(deps);
  const events = new Map<string, string[]>();
  const log = (personaId: string, line: string) =>
    events.set(personaId, [...(events.get(personaId) ?? []), line]);
  const owed = new Map<string, PendingPost[]>(
    [...world.personas.values()].map((p) => [p.id, [...p.pendingPosts]]),
  );

  for (const key of [...world.relationships.keys()]) {
    const current = world.relationships.get(key)!;
    const { relationship, transition } = advanceDaily(current.rel, dayEnd, random, config.grudge);
    world.relationships.set(key, { ...current, rel: relationship });
    await repos.saveRelationship(relationship, transition ? dayEnd : undefined);
    if (!transition) continue;
    report.transitions++;
    const { from, to } = relationship;
    log(from, `${world.name(to)}: ${transition.from} → ${transition.to}`);
    const format = transitionPostFormat(transition);
    if (format && owed.has(from)) {
      owed.get(from)!.push({ format, targetId: to });
      report.ladderPostsQueued++;
    }
    if (transition.to === "reconciled") {
      // Coffee takes two: the other side reconciles too.
      const reverse = world.relationships.get(relKey(to, from));
      if (reverse) {
        const mirrored = mirrorReconciliation(reverse.rel, dayEnd, config.grudge);
        world.relationships.set(relKey(to, from), { ...reverse, rel: mirrored.relationship });
        await repos.saveRelationship(mirrored.relationship, dayEnd);
        if (mirrored.transition) {
          report.transitions++;
          log(to, `${world.name(from)}: ${mirrored.transition.from} → reconciled (coffee)`);
        }
      }
    }
  }
  for (const [personaId, pending] of owed) {
    const before = world.personas.get(personaId)!.pendingPosts;
    if (pending.length !== before.length) await repos.setPendingPosts(personaId, pending);
  }

  // FR-17: condense each active persona's day into its career summary.
  const contexts: RequestContext[] = [];
  for (const p of world.personas.values()) {
    const posts = (await repos.recentPostsBy(p.id, 10)).filter((x) => dayKey(x.createdAt) === day);
    if (posts.length === 0 && !events.has(p.id)) continue;
    const prompt = tryBuild(() =>
      buildSummaryPrompt(
        deps.content,
        personaCard(p),
        {
          ...(p.careerSummary ? { previousSummary: p.careerSummary } : {}),
          posts: posts.map((x) => x.body),
          events: events.get(p.id) ?? [],
        },
        config,
      ),
    );
    if (prompt) contexts.push({ stage: "summary", personaId: p.id, prompt, attempt: 0 });
  }
  if (contexts.length > 0) {
    const { requests, byId } = toBatch(contexts);
    const providerId = await deps.llm.submitBatch(requests);
    report.batchId = await repos.createBatch(providerId, "nightly", byId);
    report.summariesSubmitted = requests.length;
  }
  deps.log("nightly", { ...report });
  return report;
}
