import { afterEach, describe, expect, it, vi } from "vitest";
import { createAnthropicProvider } from "@/src/providers/anthropic";
import { createGeminiProvider } from "@/src/providers/gemini";
import { createOpenAiProvider } from "@/src/providers/openai";
import type { StructuredCall } from "@/src/providers/types";

const call: StructuredCall = {
  model: "claude-haiku-5-5", system: "sys", prompt: "ciao", schemaName: "x",
  jsonSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false },
  maxOutputTokens: 100, timeoutMs: 1000,
};

type Seen = { url: string; body: Record<string, unknown>; headers: Headers };

function stubFetch(payload: unknown, status = 200): Seen[] {
  const seen: Seen[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(input), body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) });
    return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
  }));
  return seen;
}

const anthropicReply = (overrides = {}) => ({
  id: "m", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: "end_turn",
  content: [{ type: "text", text: '{"ok":true}' }], usage: { input_tokens: 5, output_tokens: 7 }, ...overrides,
});

afterEach(() => vi.unstubAllGlobals());

describe("anthropic adapter", () => {
  it("requests structured output and reads usage", async () => {
    const seen = stubFetch(anthropicReply());
    const result = await createAnthropicProvider("k").complete(call);
    expect(seen[0]?.body.output_config).toEqual({ format: { type: "json_schema", schema: call.jsonSchema } });
    expect(result).toEqual({ text: '{"ok":true}', model: "claude-haiku-5-5", inputTokens: 5, outputTokens: 7 });
  });

  it("enables the server-side fallback on Sonnet 5.5, with the matching beta", async () => {
    const seen = stubFetch(anthropicReply({ model: "claude-sonnet-5-5" }));
    await createAnthropicProvider("k").complete({ ...call, model: "claude-sonnet-5-5" });
    expect(seen[0]?.body.fallbacks).toBe("default");
    expect(seen[0]?.headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
  });

  it("does not send fallbacks to Haiku", async () => {
    const seen = stubFetch(anthropicReply());
    await createAnthropicProvider("k").complete(call);
    expect(seen[0]?.body.fallbacks).toBeUndefined();
  });

  it("maps refusals and truncation to a route fallback", async () => {
    stubFetch(anthropicReply({ stop_reason: "refusal" }));
    await expect(createAnthropicProvider("k").complete(call)).rejects.toMatchObject({ code: "refusal", kind: "fallback" });
    stubFetch(anthropicReply({ stop_reason: "max_tokens" }));
    await expect(createAnthropicProvider("k").complete(call)).rejects.toMatchObject({ code: "max_tokens", kind: "fallback" });
  });

  it("classifies rate limits as retryable, without exposing the body", async () => {
    stubFetch({ type: "error", error: { type: "rate_limit_error", message: "secret detail" } }, 429);
    await expect(createAnthropicProvider("k").complete(call)).rejects.toMatchObject({ code: "http_429", kind: "retryable", message: "http_429" });
  });
});

describe("openai adapter", () => {
  it("uses strict JSON schema on the Responses API", async () => {
    const seen = stubFetch({
      id: "r", object: "response", model: "gpt-x", status: "completed", output: [
        { type: "message", role: "assistant", content: [{ type: "output_text", text: '{"ok":true}', annotations: [] }] },
      ], usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 },
    });
    const result = await createOpenAiProvider("k").complete({ ...call, model: "gpt-x" });
    expect(seen[0]?.url).toContain("/responses");
    expect(seen[0]?.body.text).toEqual({ format: { type: "json_schema", name: "x", schema: call.jsonSchema, strict: true } });
    expect(result).toEqual({ text: '{"ok":true}', model: "gpt-x", inputTokens: 3, outputTokens: 4 });
  });
});

describe("gemini adapter", () => {
  it("requests JSON with the response schema", async () => {
    const seen = stubFetch({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }], usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 6 } });
    const result = await createGeminiProvider("k").complete({ ...call, model: "gemini-x" });
    expect(seen[0]?.url).toContain("gemini-x:generateContent");
    expect(JSON.stringify(seen[0]?.body)).toContain("application/json");
    expect(result).toEqual({ text: '{"ok":true}', model: "gemini-x", inputTokens: 2, outputTokens: 6 });
  });
});
