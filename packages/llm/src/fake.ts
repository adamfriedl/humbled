import { estimateTokens } from "@humbled/comedy";
import type { Config } from "@humbled/config";
import { ModelRouter } from "./router.ts";
import type { LLMClient, LLMRequest, LLMResult } from "./types.ts";

export type FakeResponder = (req: LLMRequest) => unknown;

/**
 * Deterministic offline client for tests and `make simulate FAKE=1`. Usage is estimated from
 * the prompt, and a system prefix seen before is billed as a cache read, so cost reports are
 * meaningful without a network.
 */
export class FakeLLMClient implements LLMClient {
  private readonly router: ModelRouter;
  private readonly seenPrefixes = new Set<string>();
  private readonly batches = new Map<string, LLMResult[]>();
  private batchCounter = 0;
  readonly calls: LLMRequest[] = [];

  constructor(
    private readonly respond: FakeResponder,
    llm: Config["llm"],
  ) {
    this.router = new ModelRouter(llm);
  }

  async complete(req: LLMRequest): Promise<LLMResult> {
    this.calls.push(req);
    const model = this.router.route(req.callType).model;
    const prefix = req.prompt.system.map((b) => b.text).join("\u0000");
    const systemTokens = estimateTokens(prefix);
    const cached = this.seenPrefixes.has(prefix);
    this.seenPrefixes.add(prefix);
    let json: unknown;
    try {
      json = this.respond(req);
    } catch (e) {
      return { id: req.id, ok: false, error: "api_error", detail: String(e), model };
    }
    const usage = {
      inputTokens: req.prompt.estimatedInputTokens - systemTokens,
      cacheReadTokens: cached ? systemTokens : 0,
      cacheWriteTokens: cached ? 0 : systemTokens,
      outputTokens: estimateTokens(JSON.stringify(json)),
    };
    return { id: req.id, ok: true, json, usage, model };
  }

  async submitBatch(reqs: readonly LLMRequest[]): Promise<string> {
    const id = `fakebatch_${++this.batchCounter}`;
    this.batches.set(id, await Promise.all(reqs.map((r) => this.complete(r))));
    return id;
  }

  async batchEnded(batchId: string): Promise<boolean> {
    return this.batches.has(batchId);
  }

  async batchResults(batchId: string): Promise<LLMResult[]> {
    const results = this.batches.get(batchId);
    if (!results) throw new Error(`unknown batch ${batchId}`);
    return results;
  }
}
