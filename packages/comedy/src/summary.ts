import type { Config } from "@humbled/config";
import type { ContentBundle } from "@humbled/content";
import { assemble, listSection, type Section } from "./assemble.ts";
import { globalBlock, personaBlock, typeBlock } from "./blocks.ts";
import { sanitizeUntrusted } from "./quoting.ts";
import type { BuiltPrompt, PersonaCard } from "./types.ts";

export const SUMMARY_OUTPUT_SCHEMA = {
  type: "object",
  properties: { summary: { type: "string" } },
  required: ["summary"],
  additionalProperties: false,
} as const;

export interface DayRecap {
  previousSummary?: string;
  posts: string[];
  /** One-liners, e.g. "Rafi Goldberg: comment war → public exit". */
  events: string[];
}

/**
 * FR-17: condense a persona's day into its rolling career summary. Shares the persona's cached
 * system tiers, so it's cheap. Canon is never rewritten here.
 */
export function buildSummaryPrompt(
  content: ContentBundle,
  persona: PersonaCard,
  recap: DayRecap,
  config: Config,
): BuiltPrompt {
  const mod = content.personaTypes.get(persona.type);
  if (!mod) throw new Error(`unknown persona type: ${persona.type}`);
  const system = [globalBlock(content), typeBlock(mod), personaBlock(persona)];
  const sections: Section[] = [
    {
      name: "previous",
      trimPriority: Infinity,
      render: () =>
        `## Your career summary so far\n${recap.previousSummary ? sanitizeUntrusted(recap.previousSummary, 2000) : "(none yet)"}`,
    },
    listSection(
      "posts",
      1,
      recap.posts,
      (ps) =>
        `## What you posted today\n${ps.map((p) => `<post>\n${sanitizeUntrusted(p, 900)}\n</post>`).join("\n")}`,
    ),
    listSection(
      "events",
      2,
      recap.events,
      (es) =>
        `## What happened today\n${es.map((e) => `- ${sanitizeUntrusted(e, 200)}`).join("\n")}`,
    ),
    {
      name: "task",
      trimPriority: Infinity,
      render: () =>
        [
          "# Your task",
          "This is a private note for your own memory, not a post. Update your career summary to include today, in plain third-person notes (no hashtags, no performance).",
          "Keep the running jokes, recurring details, grudges and alliances, and anything you might call back to later. Drop what no longer matters. Never contradict canon.",
          "At most 200 words.",
        ].join("\n\n"),
    },
  ];
  return assemble(
    "summary",
    system,
    sections,
    config.llm.maxOutputTokens.summary,
    SUMMARY_OUTPUT_SCHEMA,
    config.llm,
  );
}
