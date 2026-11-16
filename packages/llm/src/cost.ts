import type { Config } from "@humbled/config";
import type { LLMUsage, SpendEntry, SpendLedger, Transport } from "./types.ts";

export class UnknownModelPriceError extends Error {
  constructor(readonly model: string) {
    super(`no price configured for model ${model}; add it to llm.pricing`);
  }
}

/**
 * Estimated USD for one call. `inputTokens` excludes cached tokens (as the API reports it);
 * cache reads and writes are priced as multiples of the input rate.
 */
export function estimateCostUsd(
  usage: LLMUsage,
  model: string,
  transport: Transport,
  llm: Config["llm"],
): number {
  const price = llm.pricing[model];
  if (!price) throw new UnknownModelPriceError(model);
  const inRate = price.inputPerMTok / 1e6;
  const outRate = price.outputPerMTok / 1e6;
  const raw =
    usage.inputTokens * inRate +
    usage.cacheReadTokens * inRate * llm.cacheReadMultiplier +
    usage.cacheWriteTokens * inRate * llm.cacheWriteMultiplier +
    usage.outputTokens * outRate;
  return transport === "batch" ? raw * (1 - llm.batchDiscount) : raw;
}

export const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/** In-memory ledger for tests and the simulator. Production uses the spend_ledger table. */
export class InMemorySpendLedger implements SpendLedger {
  readonly entries: SpendEntry[] = [];

  async record(entry: SpendEntry): Promise<void> {
    this.entries.push(entry);
  }

  async spentOn(day: string, transport: Transport): Promise<number> {
    return this.entries
      .filter((e) => e.transport === transport && dayKey(e.at) === day)
      .reduce((s, e) => s + e.estCostUsd, 0);
  }
}
