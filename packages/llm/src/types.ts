import type { BuiltPrompt } from "@humbled/comedy";

export type CallType = "post" | "comment" | "summary" | "judge" | "relationshipNote";
export type Transport = "realtime" | "batch";

export interface LLMRequest {
  /** Unique within a batch; becomes the batch custom_id (1-64 chars, [A-Za-z0-9_-]). */
  id: string;
  callType: CallType;
  prompt: BuiltPrompt;
}

export interface LLMUsage {
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
}

export type LLMFailure =
  "refusal" | "max_tokens" | "invalid_json" | "api_error" | "expired" | "canceled";

export type LLMResult =
  | { id: string; ok: true; json: unknown; usage: LLMUsage; model: string }
  | { id: string; ok: false; error: LLMFailure; detail?: string; usage?: LLMUsage; model: string };

/** Port for all model calls (PRD: ports and adapters). */
export interface LLMClient {
  /** Real-time call (first posts, nudges, simulation). */
  complete(req: LLMRequest): Promise<LLMResult>;
  /** Submit a batch; returns the provider batch id. */
  submitBatch(reqs: readonly LLMRequest[]): Promise<string>;
  /** True once every request in the batch has a result. */
  batchEnded(batchId: string): Promise<boolean>;
  batchResults(batchId: string): Promise<LLMResult[]>;
}

export interface SpendEntry {
  callType: CallType;
  model: string;
  transport: Transport;
  usage: LLMUsage;
  estCostUsd: number;
  at: Date;
}

/** CR-7: records estimated spend and answers "how much today". */
export interface SpendLedger {
  record(entry: SpendEntry): Promise<void>;
  spentOn(day: string, transport: Transport): Promise<number>;
}
