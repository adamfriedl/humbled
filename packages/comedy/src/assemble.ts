import type { Config } from "@humbled/config";
import { estimateTokens, PromptBudgetError } from "./budget.ts";
import type { BuiltPrompt, PromptBlock, PromptKind } from "./types.ts";

/** A user-message section and how it can be trimmed under the token budget. */
export interface Section {
  name: string;
  /** Lower trims first. Infinity = never trimmed. */
  trimPriority: number;
  /**
   * Renders the section at a trim level: 0 is full, each level is smaller. Returns null for a
   * level beyond the most it can be trimmed. An empty string means "present but empty".
   */
  render: (level: number) => string | null;
}

/**
 * CR-4: enforce the input budget by shrinking the lowest-priority section one level at a time
 * (feed sample first). Throws PromptBudgetError if the untrimmable core alone is too big.
 */
export function assemble(
  kind: PromptKind,
  system: PromptBlock[],
  sections: Section[],
  maxTokens: number,
  outputSchema: Record<string, unknown>,
  llm: Config["llm"],
): BuiltPrompt {
  const levels = new Map(sections.map((s) => [s.name, 0]));
  const systemTokens = system.reduce((n, b) => n + estimateTokens(b.text), 0);
  const trimmed: string[] = [];

  const render = () =>
    sections
      .map((s) => s.render(levels.get(s.name)!))
      .filter((t): t is string => !!t)
      .join("\n\n");

  let user = render();
  let total = systemTokens + estimateTokens(user);
  const order = [...sections]
    .filter((s) => Number.isFinite(s.trimPriority))
    .sort((a, b) => a.trimPriority - b.trimPriority);

  for (const s of order) {
    while (total > llm.maxInputTokens && s.render(levels.get(s.name)! + 1) !== null) {
      levels.set(s.name, levels.get(s.name)! + 1);
      trimmed.push(s.name);
      user = render();
      total = systemTokens + estimateTokens(user);
    }
    if (total <= llm.maxInputTokens) break;
  }
  if (total > llm.maxInputTokens) throw new PromptBudgetError(total, llm.maxInputTokens);

  return { kind, system, user, maxTokens, outputSchema, estimatedInputTokens: total, trimmed };
}

/** Helper: a list section that drops one item (from the end) per level, down to `minItems`. */
export function listSection<T>(
  name: string,
  trimPriority: number,
  items: readonly T[],
  renderItems: (items: readonly T[]) => string,
  minItems = 0,
): Section {
  const maxLevel = Math.max(0, items.length - minItems);
  return {
    name,
    trimPriority,
    render: (level) => {
      if (level > maxLevel) return null;
      const kept = items.slice(0, items.length - level);
      return kept.length === 0 ? "" : renderItems(kept);
    },
  };
}

/** Helper: a section that is either present (level 0) or dropped (level 1). */
export function optionalSection(name: string, trimPriority: number, text: string): Section {
  return { name, trimPriority, render: (level) => (level === 0 ? text : level === 1 ? "" : null) };
}
