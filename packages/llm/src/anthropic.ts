import Anthropic from "@anthropic-ai/sdk";
import type { Config } from "@humbled/config";
import { ModelRouter } from "./router.ts";
import type { LLMClient, LLMFailure, LLMRequest, LLMResult, LLMUsage } from "./types.ts";

export interface AnthropicClientOptions {
  apiKey: string;
  llm: Config["llm"];
  /** For tests: inject a preconstructed SDK client. */
  sdk?: Anthropic;
}

const CUSTOM_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Map a BuiltPrompt-based request onto Messages API params. Exported for tests. */
export function toMessageParams(
  req: LLMRequest,
  router: ModelRouter,
): Anthropic.MessageCreateParamsNonStreaming {
  const route = router.route(req.callType);
  const { prompt } = req;
  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model: route.model,
    max_tokens: prompt.maxTokens,
    system: prompt.system.map((b) => ({
      type: "text" as const,
      text: b.text,
      ...(b.cache ? { cache_control: { type: "ephemeral" as const } } : {}),
    })),
    messages: [{ role: "user", content: prompt.user }],
    output_config: {
      format: { type: "json_schema", schema: prompt.outputSchema },
      ...(route.thinking === "off" ? {} : { effort: route.thinking }),
    },
    thinking: route.thinking === "off" ? { type: "disabled" } : { type: "adaptive" },
  };
  return params;
}

function usageOf(u: Anthropic.Usage): LLMUsage {
  return {
    inputTokens: u.input_tokens,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    outputTokens: u.output_tokens,
  };
}

/** Turn a Message into a result: refusal and truncation are failures; JSON must parse. */
export function resultFromMessage(id: string, msg: Anthropic.Message): LLMResult {
  const usage = usageOf(msg.usage);
  const model = msg.model;
  if (msg.stop_reason === "refusal") return { id, ok: false, error: "refusal", usage, model };
  if (msg.stop_reason === "max_tokens") return { id, ok: false, error: "max_tokens", usage, model };
  const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  try {
    return { id, ok: true, json: JSON.parse(text), usage, model };
  } catch {
    return { id, ok: false, error: "invalid_json", detail: text.slice(0, 200), usage, model };
  }
}

export class AnthropicLLMClient implements LLMClient {
  private readonly sdk: Anthropic;
  private readonly router: ModelRouter;

  constructor(opts: AnthropicClientOptions) {
    if (!opts.apiKey) throw new Error("Anthropic API key is required (set ANTHROPIC_API_KEY)");
    // baseURL is explicit so an ANTHROPIC_BASE_URL meant for another tool is never inherited.
    this.sdk = opts.sdk ?? new Anthropic({ apiKey: opts.apiKey, baseURL: opts.llm.baseURL });
    this.router = new ModelRouter(opts.llm);
  }

  async complete(req: LLMRequest): Promise<LLMResult> {
    const model = this.router.route(req.callType).model;
    try {
      const msg = await this.sdk.messages.create(toMessageParams(req, this.router));
      return resultFromMessage(req.id, msg);
    } catch (e) {
      if (e instanceof Anthropic.APIError) {
        return {
          id: req.id,
          ok: false,
          error: "api_error",
          detail: `${e.status ?? "?"} ${e.message}`,
          model,
        };
      }
      throw e;
    }
  }

  async submitBatch(reqs: readonly LLMRequest[]): Promise<string> {
    for (const r of reqs)
      if (!CUSTOM_ID.test(r.id)) throw new Error(`invalid batch request id: ${r.id}`);
    const batch = await this.sdk.messages.batches.create({
      requests: reqs.map((r) => ({ custom_id: r.id, params: toMessageParams(r, this.router) })),
    });
    return batch.id;
  }

  async batchEnded(batchId: string): Promise<boolean> {
    const batch = await this.sdk.messages.batches.retrieve(batchId);
    return batch.processing_status === "ended";
  }

  async batchResults(batchId: string): Promise<LLMResult[]> {
    const out: LLMResult[] = [];
    for await (const r of await this.sdk.messages.batches.results(batchId)) {
      const model = "unknown";
      switch (r.result.type) {
        case "succeeded":
          out.push(resultFromMessage(r.custom_id, r.result.message));
          break;
        case "errored":
          out.push({
            id: r.custom_id,
            ok: false,
            error: "api_error",
            detail: r.result.error.error.type,
            model,
          });
          break;
        default: {
          const error: LLMFailure = r.result.type === "expired" ? "expired" : "canceled";
          out.push({ id: r.custom_id, ok: false, error, model });
        }
      }
    }
    return out;
  }
}
