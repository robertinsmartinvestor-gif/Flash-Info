import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AiRouter, AllRoutesFailedError, BudgetExceededError, estimateCostUsd, loadAiConfig, loadPricing, type AiConfig } from "@/src/providers/router";
import { classifyStatus, ProviderError, type LlmProvider, type ProviderName } from "@/src/providers/types";
import { MemoryStore } from "@/src/store/memory";

const config: AiConfig = {
  routes: { script: [{ provider: "anthropic", model: "m1" }, { provider: "openai", model: "m2" }], verify: [{ provider: "anthropic", model: "m1" }] },
  timeoutMs: 1000,
  maxRetries: 2,
};
const pricing = { m1: { input: 1, output: 2 }, m2: { input: 1, output: 2 } };
const request = { feature: "script" as const, schemaName: "x", schema: z.object({ ok: z.boolean() }), system: "s", prompt: "p" };
const good = { text: '{"ok":true}', model: "m1", inputTokens: 1_000_000, outputTokens: 1_000_000 };

function provider(name: ProviderName, complete: LlmProvider["complete"]): LlmProvider {
  return { name, complete };
}

function setup(providers: Partial<Record<ProviderName, LlmProvider>>, monthlyBudgetUsd = 10) {
  const ledger = new MemoryStore();
  return { ledger, router: new AiRouter({ providers, config, pricing, ledger, monthlyBudgetUsd, sleep: async () => undefined }) };
}

describe("AiRouter", () => {
  it("returns validated data and records tokens and cost", async () => {
    const { router, ledger } = setup({ anthropic: provider("anthropic", async () => good) });
    const result = await router.generate(request);
    expect(result.data).toEqual({ ok: true });
    expect(ledger.usage[0]).toMatchObject({ provider: "anthropic", inputTokens: 1_000_000, outputTokens: 1_000_000, estimatedCostUsd: 3, success: true });
  });

  it("retries temporary failures on the same route", async () => {
    const complete = vi.fn().mockRejectedValueOnce(new ProviderError("http_429", "retryable")).mockResolvedValueOnce(good);
    const { router } = setup({ anthropic: provider("anthropic", complete) });
    await router.generate(request);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("stops retrying at the limit and moves to the next provider", async () => {
    const failing = vi.fn().mockRejectedValue(new ProviderError("http_500", "retryable"));
    const backup = vi.fn().mockResolvedValue({ ...good, model: "m2" });
    const { router } = setup({ anthropic: provider("anthropic", failing), openai: provider("openai", backup) });
    const result = await router.generate(request);
    expect(failing).toHaveBeenCalledTimes(3);
    expect(result.route).toEqual({ provider: "openai", model: "m2" });
  });

  it("does not retry a refusal, it falls back at once", async () => {
    const refusing = vi.fn().mockRejectedValue(new ProviderError("refusal", "fallback"));
    const { router } = setup({ anthropic: provider("anthropic", refusing), openai: provider("openai", async () => ({ ...good, model: "m2" })) });
    await router.generate(request);
    expect(refusing).toHaveBeenCalledTimes(1);
  });

  it("treats invalid output as a failure of that route and charges for it", async () => {
    const { router, ledger } = setup({
      anthropic: provider("anthropic", async () => ({ ...good, text: "not json" })),
      openai: provider("openai", async () => ({ ...good, model: "m2", text: '{"ok":"yes"}' })),
    });
    await expect(router.generate(request)).rejects.toBeInstanceOf(AllRoutesFailedError);
    expect(ledger.usage.map((usage) => usage.success)).toEqual([false, false]);
    expect(await ledger.monthSpendUsd()).toBe(6);
  });

  it("skips providers without a key", async () => {
    const { router } = setup({ openai: provider("openai", async () => ({ ...good, model: "m2" })) });
    await expect(router.generate(request)).resolves.toMatchObject({ route: { provider: "openai" } });
  });

  it("blocks calls once the monthly budget is used", async () => {
    const complete = vi.fn().mockResolvedValue(good);
    const { router, ledger } = setup({ anthropic: provider("anthropic", complete) }, 3);
    await router.generate(request);
    await expect(router.generate(request)).rejects.toBeInstanceOf(BudgetExceededError);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(await ledger.monthSpendUsd()).toBe(3);
  });
});

describe("estimateCostUsd", () => {
  it("never treats an unknown model as free", () => {
    expect(estimateCostUsd({}, "new-model", 1_000_000, 0)).toBeGreaterThan(0);
  });
});

describe("configuration", () => {
  it("loads the shipped files, with a price for every routed model", () => {
    const shipped = loadAiConfig({});
    const prices = loadPricing();
    for (const route of Object.values(shipped.routes).flat()) expect(prices[route.model], route.model).toBeDefined();
  });

  it("lets the environment replace a route", () => {
    const { routes } = loadAiConfig({ AI_ROUTE_SCRIPT: "openai:gpt-x, gemini:g:1" });
    expect(routes.script).toEqual([{ provider: "openai", model: "gpt-x" }, { provider: "gemini", model: "g:1" }]);
  });

  it("rejects an unknown provider", () => {
    expect(() => loadAiConfig({ AI_ROUTE_SCRIPT: "acme:model" })).toThrow();
  });
});

describe("classifyStatus", () => {
  it("separates temporary and permanent failures", () => {
    expect(classifyStatus(429).kind).toBe("retryable");
    expect(classifyStatus(503).kind).toBe("retryable");
    expect(classifyStatus(401).kind).toBe("fallback");
    expect(classifyStatus(undefined).kind).toBe("retryable");
  });
});
