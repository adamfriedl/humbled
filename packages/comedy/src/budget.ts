/** Conservative token estimate: ~3.5 characters per token for English prose. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

export class PromptBudgetError extends Error {
  constructor(
    readonly estimated: number,
    readonly limit: number,
  ) {
    super(`prompt needs ~${estimated} input tokens, limit is ${limit}`);
  }
}
