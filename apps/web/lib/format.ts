// Pure presentation helpers, shared by server and client components.
import type { PersonaType, ReactionKind, RelationshipStage } from "@humbled/domain";

/** "now", "12m", "3h", "4d", then a date: the feed's relative timestamps. */
export function timeAgo(then: Date, now: Date): string {
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return then.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** A colour per persona type, so a feed (or a share card) reads as a cast of characters. */
export const PERSONA_TONES: Record<PersonaType, { bg: string; fg: string }> = {
  hustle_bro: { bg: "#2f2a24", fg: "#f6f1e7" },
  ai_evangelist: { bg: "#3d5a4c", fg: "#f0f5ef" },
  recruiter: { bg: "#c9a227", fg: "#1c1a17" },
  perma_founder: { bg: "#8a4b2a", fg: "#fff4ea" },
  grateful_layoff: { bg: "#6c7a5b", fg: "#f6f7f0" },
  thought_leader: { bg: "#5b4a72", fg: "#f5f0fa" },
  middle_manager: { bg: "#9a8f80", fg: "#1c1a17" },
  gen_z_disruptor: { bg: "#d9480f", fg: "#fff8f3" },
};

export const PERSONA_TYPE_LABELS: Record<PersonaType, string> = {
  hustle_bro: "Hustle Bro",
  ai_evangelist: "AI Evangelist",
  recruiter: "Recruiter",
  perma_founder: "Perma-Founder",
  grateful_layoff: "Grateful Layoff",
  thought_leader: "Thought Leader",
  middle_manager: "Middle Manager",
  gen_z_disruptor: "Gen Z Disruptor",
};

/**
 * Our own reaction names and emoji (SR-7: not the real network's set or icons). Emoji rather
 * than symbol characters, so they render the same on every device.
 */
export const REACTIONS: Record<ReactionKind, { label: string; mark: string }> = {
  like: { label: "Agree", mark: "👍" },
  celebrate: { label: "Applaud", mark: "👏" },
  insightful: { label: "Profound", mark: "🧠" },
  support: { label: "Stand with", mark: "🫡" },
  love: { label: "Grateful", mark: "🙏" },
  curious: { label: "Intrigued", mark: "🤔" },
};

export const STAGE_LABELS: Record<RelationshipStage, string> = {
  neutral: "Connected",
  cold: "Polite distance",
  vague_posting: "Vague-posting about each other",
  comment_war: "Comment war",
  public_exit: "Publicly parted ways",
  reconciled: "Reconciled over coffee",
};

/** Two initials for the avatar placeholder. */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

/** Reaction kinds present on a post, most-used first (ties in a fixed order). */
export function topReactions(
  byKind: Partial<Record<ReactionKind, number>>,
  max = 3,
): ReactionKind[] {
  const order = Object.keys(REACTIONS) as ReactionKind[];
  return order
    .filter((k) => (byKind[k] ?? 0) > 0)
    .sort((a, b) => (byKind[b] ?? 0) - (byKind[a] ?? 0) || order.indexOf(a) - order.indexOf(b))
    .slice(0, max);
}

export interface ThreadNode<T extends { id: string; parentId: string | null }> {
  comment: T;
  replies: ThreadNode<T>[];
}

/** Nest a flat, oldest-first comment list by parentId. Orphans surface at the top level. */
export function nestThread<T extends { id: string; parentId: string | null }>(
  flat: readonly T[],
): ThreadNode<T>[] {
  const nodes = new Map(flat.map((c) => [c.id, { comment: c, replies: [] as ThreadNode<T>[] }]));
  const roots: ThreadNode<T>[] = [];
  for (const c of flat) {
    const node = nodes.get(c.id)!;
    const parent = c.parentId ? nodes.get(c.parentId) : undefined;
    (parent ? parent.replies : roots).push(node);
  }
  return roots;
}

export type ReactionCounts = { total: number; byKind: Partial<Record<ReactionKind, number>> };

/** The counts after the viewer changes their reaction, for an optimistic update. */
export function applyReaction(
  counts: ReactionCounts,
  from: ReactionKind | null,
  to: ReactionKind | null,
): ReactionCounts {
  const next = new Map(Object.entries(counts.byKind) as [ReactionKind, number][]);
  if (from) next.set(from, (next.get(from) ?? 0) - 1);
  if (to) next.set(to, (next.get(to) ?? 0) + 1);
  const byKind = Object.fromEntries([...next].filter(([, n]) => n > 0));
  const total = counts.total - (from ? 1 : 0) + (to ? 1 : 0);
  return { total: Math.max(0, total), byKind };
}

/**
 * The feed's collapsed view of a post: its first few lines of actual text (blank lines between
 * them are kept but don't count) or `maxChars`, whichever comes first. `truncated` says whether
 * anything was left out, which is when the feed shows "…more".
 */
export function excerpt(
  body: string,
  opts: { maxLines?: number; maxChars?: number } = {},
): { text: string; truncated: boolean } {
  const maxLines = opts.maxLines ?? 3;
  const maxChars = opts.maxChars ?? 220;
  const lines = body.trim().split("\n");
  const kept: string[] = [];
  let textLines = 0;
  let chars = 0;
  let i = 0;
  for (; i < lines.length && textLines < maxLines; i++) {
    const line = lines[i]!;
    if (line.trim() === "") {
      kept.push(line);
      continue;
    }
    if (chars + line.length > maxChars) {
      const room = Math.max(0, maxChars - chars);
      const cut = line.slice(0, room);
      const atSpace = cut.lastIndexOf(" ");
      kept.push((atSpace > room / 2 ? cut.slice(0, atSpace) : cut).trimEnd());
      return { text: kept.join("\n").trim(), truncated: true };
    }
    kept.push(line);
    chars += line.length;
    textLines++;
  }
  const truncated = lines.slice(i).some((l) => l.trim() !== "");
  return { text: kept.join("\n").trim(), truncated };
}
