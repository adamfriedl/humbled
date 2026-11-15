import type { GoldenPost } from "@humbled/content";
import { sanitizeUntrusted } from "./quoting.ts";
import type { FeedSampleItem, PersonaMemory, RelationshipContext } from "./types.ts";

const firstName = (name: string) => name.split(/\s+/)[0] ?? name;

export function memorySection(memory: PersonaMemory, includeOpenings: boolean): string {
  const parts: string[] = [];
  if (memory.careerSummary) parts.push(`## Your career so far\n${memory.careerSummary.trim()}`);
  if (includeOpenings && memory.recentOpenings.length) {
    parts.push(
      `## Your recent openings (don't start the same way)\n${memory.recentOpenings
        .slice(0, 5)
        .map((o) => `- "${sanitizeUntrusted(o, 80)}…"`)
        .join("\n")}`,
    );
  }
  return parts.join("\n\n");
}

const STAGE_DESCRIPTION: Record<string, string> = {
  neutral: "no strong feelings",
  cold: "you've quietly stopped engaging with them",
  vague_posting: "you vague-post about them without naming them",
  comment_war: "you're in a public 'respectful disagreement' in each other's comments",
  public_exit: "you've publicly removed their 'energy' from your network",
  reconciled: "you recently reconciled over coffee",
};

export function relationshipsSection(
  rels: readonly RelationshipContext[],
  maxNotes: number,
): string {
  if (rels.length === 0) return "";
  const lines = rels.map((r) => {
    const feeling =
      r.affinity >= 0.5 ? "an ally (you hype each other)" : (STAGE_DESCRIPTION[r.stage] ?? r.stage);
    const notes = r.notes.slice(-maxNotes).map((n) => `  - ${sanitizeUntrusted(n, 160)}`);
    return [
      `- ${sanitizeUntrusted(r.otherName, 40)}: ${feeling}.`,
      r.history ? `  Backstory: ${sanitizeUntrusted(r.history, 240)}` : "",
      ...notes,
    ]
      .filter(Boolean)
      .join("\n");
  });
  return `## People in your orbit\n${lines.join("\n")}`;
}

export function feedSection(feed: readonly FeedSampleItem[]): string {
  if (feed.length === 0) return "";
  const items = feed.map(
    (f) =>
      `<post author="${sanitizeUntrusted(f.authorName, 40)}" reactions="${f.reactions}">\n${sanitizeUntrusted(f.body, 900)}\n</post>`,
  );
  return `## What's on your feed today (context only; don't copy)\n${items.join("\n")}`;
}

export function fewShotSection(examples: readonly GoldenPost[]): string {
  if (examples.length === 0) return "";
  const items = examples.map((g) => `<example>\n${g.body.trim()}\n</example>`);
  return `## Posts that hit the bar (different people, for tone and quality only; never reuse their jokes)\n${items.join("\n")}`;
}

/** Guidance for a post that carries grudge or alliance content about `r`. */
export function grudgeGuidance(r: RelationshipContext): string {
  const name = sanitizeUntrusted(r.otherName, 40);
  if (r.affinity >= 0.5)
    return `${name} is in your circle. You may tag them by name as a supporter or collaborator.`;
  switch (r.stage) {
    case "cold":
      return `You've quietly stopped engaging with ${name}. Don't mention them; at most a faint, deniable allusion.`;
    case "vague_posting":
      return `This post is secretly about ${name}. Never name them. Anyone who knows will know.`;
    case "comment_war":
      return `You're in a public "respectful disagreement" with ${name}. You may allude to it, unnamed, with weaponized serenity.`;
    case "public_exit":
      return `You've removed ${name} from your network. You may allude to "toxic energy" you've let go of, unnamed.`;
    case "reconciled":
      return `You recently reconciled with ${name}. You may mention them by name, warmly, slightly too warmly.`;
    default:
      return `You may reference ${name} if it fits naturally.`;
  }
}

/** Guidance for a comment or reply, from the commenter's relationship to the author. */
export function commentGuidance(r: RelationshipContext | undefined, authorName: string): string {
  const name = firstName(sanitizeUntrusted(authorName, 40));
  if (!r) return "Comment in your usual style.";
  if (r.affinity >= 0.5)
    return `${name} is an ally. Hype them immediately and specifically, like a member of the same engagement pod.`;
  switch (r.stage) {
    case "comment_war":
      return `You're in a "respectful disagreement" with ${name}. Open warmly ("Love this, ${name}!"), then "respectfully" push back with invented data or a better anecdote of your own. Passive-aggressive, never rude.`;
    case "reconciled":
      return `You and ${name} recently reconciled. Be effusive. Slightly too effusive.`;
    default:
      return "Comment in your usual style.";
  }
}
