import type { Config } from "@humbled/config";
import { MS_PER_MINUTE } from "./ports.ts";
import type { DailyCounts, PersonaId } from "./types.ts";

export function canPost(counts: DailyCounts, q: Config["quotas"]): boolean {
  return counts.posts < q.postsPerDay;
}

export function canComment(counts: DailyCounts, q: Config["quotas"]): boolean {
  return counts.comments < q.commentsPerDay;
}

export function canNudge(counts: DailyCounts, q: Config["quotas"]): boolean {
  return counts.nudges < q.nudgesPerDay;
}

/** Replies are comments at depth > 1. Depth of the new reply = parent depth + 1. */
export function canReplyAtDepth(parentDepth: number, q: Config["quotas"]): boolean {
  return parentDepth + 1 <= q.maxReplyDepth;
}

/**
 * CR-6: a bot never replies to a bot it replied to within the cooldown window.
 * `lastRepliedAt` maps target persona -> when this persona last replied to them.
 */
export function replyCooldownOk(
  target: PersonaId,
  lastRepliedAt: ReadonlyMap<PersonaId, Date>,
  now: Date,
  q: Config["quotas"],
): boolean {
  const last = lastRepliedAt.get(target);
  if (!last) return true;
  return now.getTime() - last.getTime() >= q.replyCooldownMinutes * MS_PER_MINUTE;
}
