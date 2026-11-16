import type { SpendEntry, SpendLedger, Transport } from "@humbled/llm";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { Db } from "./client.ts";
import { spendLedger } from "./schema.ts";

/**
 * CR-7 spend ledger on the spend_ledger table. Days are UTC calendar days ("YYYY-MM-DD"),
 * matching `dayKey` in @humbled/llm, so the simulator and production budget the same way.
 */
export class PgSpendLedger implements SpendLedger {
  constructor(private readonly db: Db) {}

  async record(e: SpendEntry): Promise<void> {
    await this.db.insert(spendLedger).values({
      callType: e.callType,
      model: e.model,
      transport: e.transport,
      inputTokens: e.usage.inputTokens,
      cacheReadTokens: e.usage.cacheReadTokens,
      cacheWriteTokens: e.usage.cacheWriteTokens,
      outputTokens: e.usage.outputTokens,
      estCostUsd: e.estCostUsd,
      createdAt: e.at,
    });
  }

  async spentOn(day: string, transport: Transport): Promise<number> {
    const start = new Date(`${day}T00:00:00.000Z`);
    if (Number.isNaN(start.getTime())) throw new Error(`not a UTC day: ${day}`);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    const [row] = await this.db
      .select({ total: sql<string | null>`sum(${spendLedger.estCostUsd})` })
      .from(spendLedger)
      .where(
        and(
          eq(spendLedger.transport, transport),
          gte(spendLedger.createdAt, start),
          lt(spendLedger.createdAt, end),
        ),
      );
    return Number(row?.total ?? 0);
  }
}
