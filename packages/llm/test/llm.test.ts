import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { loadConfig } from "@humbled/config";
import type { BuiltPrompt } from "@humbled/comedy";
import {
  AnthropicLLMClient,
  dayKey,
  estimateCostUsd,
  FakeLLMClient,
  InMemorySpendLedger,
  ModelRouter,
  resultFromMessage,
  toMessageParams,
  UnknownModelPriceError,
  type LLMRequest,
} from "../src/index.ts";

const llm = loadConfig().llm;
const prompt: BuiltPrompt = {
  kind: "post",
  system: [
    { text: "global rules", cache: true },
    { text: "type", cache: true },
    { text: "uncached", cache: false },
  ],
  user: "write a post",
  maxTokens: 1200,
  outputSchema: { type: "object" },
  estimatedInputTokens: 100,
  trimmed: [],
};
const req = (id = "r1", callType: LLMRequest["callType"] = "post"): LLMRequest => ({
  id,
  callType,
  prompt,
});

function message(over: Partial<Anthropic.Message> = {}): Anthropic.Message {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-haiku-5-5",
    content: [{ type: "text", text: '{"body":"hi"}', citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_read_input_tokens: 90,
      cache_creation_input_tokens: null,
    },
    ...over,
  } as Anthropic.Message;
}

describe("ModelRouter and request mapping", () => {
  it("routes call types to configured models and thinking", () => {
    const r = new ModelRouter(
      loadConfig({ llm: { models: { judge: "other-model" }, thinking: { post: "low" } } }).llm,
    );
    expect(r.route("judge")).toEqual({ model: "other-model", thinking: "off" });
    expect(r.route("post")).toEqual({ model: "claude-haiku-5-5", thinking: "low" });
  });

  it("maps cache flags, structured output and thinking off", () => {
    const p = toMessageParams(req(), new ModelRouter(llm));
    expect(p.model).toBe("claude-haiku-5-5");
    expect(p.max_tokens).toBe(1200);
    expect(p.system).toEqual([
      { type: "text", text: "global rules", cache_control: { type: "ephemeral" } },
      { type: "text", text: "type", cache_control: { type: "ephemeral" } },
      { type: "text", text: "uncached" },
    ]);
    expect(p.thinking).toEqual({ type: "disabled" });
    expect(p.output_config).toEqual({
      format: { type: "json_schema", schema: { type: "object" } },
    });
    expect(p).not.toHaveProperty("temperature");
  });

  it("maps adaptive thinking with effort", () => {
    const p = toMessageParams(
      req(),
      new ModelRouter(loadConfig({ llm: { thinking: { post: "low" } } }).llm),
    );
    expect(p.thinking).toEqual({ type: "adaptive" });
    expect(p.output_config?.effort).toBe("low");
  });
});

describe("resultFromMessage", () => {
  it("parses JSON text and usage", () => {
    expect(resultFromMessage("a", message())).toEqual({
      id: "a",
      ok: true,
      json: { body: "hi" },
      usage: { inputTokens: 10, cacheReadTokens: 90, cacheWriteTokens: 0, outputTokens: 5 },
      model: "claude-haiku-5-5",
    });
  });
  it("treats refusal, truncation and bad JSON as failures", () => {
    expect(resultFromMessage("a", message({ stop_reason: "refusal" }))).toMatchObject({
      ok: false,
      error: "refusal",
    });
    expect(resultFromMessage("a", message({ stop_reason: "max_tokens" }))).toMatchObject({
      ok: false,
      error: "max_tokens",
    });
    expect(
      resultFromMessage(
        "a",
        message({ content: [{ type: "text", text: "not json", citations: null }] }),
      ),
    ).toMatchObject({ ok: false, error: "invalid_json", detail: "not json" });
  });
});

describe("cost accounting", () => {
  const usage = {
    inputTokens: 1_000_000,
    cacheReadTokens: 1_000_000,
    cacheWriteTokens: 1_000_000,
    outputTokens: 1_000_000,
  };
  it("prices input, cache reads/writes and output; batch halves it", () => {
    // 0.10 + 0.01 + 0.125 + 0.50
    expect(estimateCostUsd(usage, "claude-haiku-5-5", "realtime", llm)).toBeCloseTo(0.735);
    expect(estimateCostUsd(usage, "claude-haiku-5-5", "batch", llm)).toBeCloseTo(0.3675);
  });
  it("refuses to guess unknown prices", () => {
    expect(() => estimateCostUsd(usage, "mystery", "batch", llm)).toThrow(UnknownModelPriceError);
  });
  it("ledger sums per day and transport", async () => {
    const l = new InMemorySpendLedger();
    const at = new Date("2026-11-15T10:00:00Z");
    const entry = { callType: "post" as const, model: "m", usage, at };
    await l.record({ ...entry, transport: "batch", estCostUsd: 1 });
    await l.record({ ...entry, transport: "batch", estCostUsd: 2 });
    await l.record({ ...entry, transport: "realtime", estCostUsd: 5 });
    await l.record({
      ...entry,
      transport: "batch",
      estCostUsd: 7,
      at: new Date("2026-11-16T10:00:00Z"),
    });
    expect(await l.spentOn(dayKey(at), "batch")).toBe(3);
    expect(await l.spentOn(dayKey(at), "realtime")).toBe(5);
  });
});

describe("FakeLLMClient", () => {
  it("bills the first system prefix as a cache write and repeats as reads", async () => {
    const fake = new FakeLLMClient(() => ({ body: "x" }), llm);
    const a = await fake.complete(req("a"));
    const b = await fake.complete(req("b"));
    expect(a.ok && a.usage.cacheWriteTokens).toBeGreaterThan(0);
    expect(b.ok && b.usage.cacheReadTokens).toBe(a.ok ? a.usage.cacheWriteTokens : -1);
    expect(fake.calls).toHaveLength(2);
  });
  it("supports batches and surfaces responder errors", async () => {
    const fake = new FakeLLMClient((r) => {
      if (r.id === "bad") throw new Error("boom");
      return { ok: true };
    }, llm);
    const id = await fake.submitBatch([req("good"), req("bad")]);
    expect(await fake.batchEnded(id)).toBe(true);
    const results = await fake.batchResults(id);
    expect(results.map((r) => r.ok)).toEqual([true, false]);
    expect(await fake.batchEnded("nope")).toBe(false);
    await expect(fake.batchResults("nope")).rejects.toThrow();
  });
});

describe("AnthropicLLMClient (with a stubbed SDK)", () => {
  function stubSdk(handlers: { create?: () => Promise<Anthropic.Message> }) {
    const results = [
      { custom_id: "ok", result: { type: "succeeded", message: message() } },
      {
        custom_id: "err",
        result: {
          type: "errored",
          error: { type: "error", error: { type: "overloaded_error", message: "x" } },
        },
      },
      { custom_id: "exp", result: { type: "expired" } },
      { custom_id: "can", result: { type: "canceled" } },
    ];
    return {
      messages: {
        create: handlers.create ?? (async () => message()),
        batches: {
          create: async (body: { requests: unknown[] }) => ({
            id: `batch_${body.requests.length}`,
          }),
          retrieve: async () => ({ processing_status: "ended" }),
          results: async () => ({
            async *[Symbol.asyncIterator]() {
              yield* results;
            },
          }),
        },
      },
    } as unknown as Anthropic;
  }

  it("requires an API key", () => {
    expect(() => new AnthropicLLMClient({ apiKey: "", llm })).toThrow(/API key/);
  });

  it("uses the configured base URL, not the environment's", () => {
    const client = new AnthropicLLMClient({
      apiKey: "sk-test",
      llm: loadConfig({ llm: { baseURL: "https://example.test" } }).llm,
    });
    expect((client as unknown as { sdk: Anthropic }).sdk.baseURL).toBe("https://example.test");
  });

  it("completes, and maps API errors to failures", async () => {
    const ok = new AnthropicLLMClient({ apiKey: "k", llm, sdk: stubSdk({}) });
    expect(await ok.complete(req())).toMatchObject({ ok: true });
    const failing = new AnthropicLLMClient({
      apiKey: "k",
      llm,
      sdk: stubSdk({
        create: async () =>
          Promise.reject(new Anthropic.APIError(529, undefined, "overloaded", undefined)),
      }),
    });
    expect(await failing.complete(req())).toMatchObject({ ok: false, error: "api_error" });
    const crashing = new AnthropicLLMClient({
      apiKey: "k",
      llm,
      sdk: stubSdk({ create: async () => Promise.reject(new TypeError("bug")) }),
    });
    await expect(crashing.complete(req())).rejects.toThrow(TypeError);
  });

  it("submits, polls and collects batches", async () => {
    const client = new AnthropicLLMClient({ apiKey: "k", llm, sdk: stubSdk({}) });
    expect(await client.submitBatch([req("a"), req("b")])).toBe("batch_2");
    await expect(client.submitBatch([req("not valid!")])).rejects.toThrow(
      /invalid batch request id/,
    );
    expect(await client.batchEnded("batch_2")).toBe(true);
    const results = await client.batchResults("batch_2");
    expect(results.map((r) => (r.ok ? "ok" : r.error))).toEqual([
      "ok",
      "api_error",
      "expired",
      "canceled",
    ]);
  });
});
