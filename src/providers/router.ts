import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { ProviderError, type AiFeature, type LlmProvider, type ModelRoute, type ProviderName, type StructuredRequest, type UsageLedger } from "./types";

const routeSchema = z.object({ provider: z.enum(["anthropic", "openai", "gemini"]), model: z.string().min(1) });
const configSchema = z.object({
  routes: z.record(z.enum(["script", "verify"]), z.array(routeSchema).min(1)),
  timeoutMs: z.number().int().positive(),
  maxRetries: z.number().int().min(0).max(5),
});
const pricingSchema = z.object({ models: z.record(z.string(), z.object({ input: z.number(), output: z.number() })) });

export type AiConfig = z.infer<typeof configSchema>;
export type Pricing = z.infer<typeof pricingSchema>["models"];

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(join(process.cwd(), "config", file), "utf8"));
}

/** `AI_ROUTE_SCRIPT=openai:gpt-6-luna,anthropic:claude-haiku-5-5` overrides a route without a deploy. */
export function loadAiConfig(env: Record<string, string | undefined> = process.env): AiConfig {
  const config = configSchema.parse(readJson("ai.json"));
  for (const feature of ["script", "verify"] as const) {
    const override = env[`AI_ROUTE_${feature.toUpperCase()}`];
    if (!override) continue;
    config.routes[feature] = override.split(",").map((entry) => {
      const [provider, ...model] = entry.trim().split(":");
      return routeSchema.parse({ provider, model: model.join(":") });
    });
  }
  return config;
}

export function loadPricing(): Pricing {
  return pricingSchema.parse(readJson("pricing.json")).models;
}

export function estimateCostUsd(pricing: Pricing, model: string, inputTokens: number, outputTokens: number): number {
  const price = pricing[model];
  // An unpriced model must not read as free to the budget guard.
  if (!price) return ((inputTokens + outputTokens) / 1_000_000) * 25;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

export class BudgetExceededError extends Error {
  constructor() {
    super("monthly_budget_exceeded");
    this.name = "BudgetExceededError";
  }
}

export class AllRoutesFailedError extends Error {
  constructor(readonly attempts: string[]) {
    super(`all_routes_failed: ${attempts.join(", ")}`);
    this.name = "AllRoutesFailedError";
  }
}

export interface RouterDeps {
  providers: Partial<Record<ProviderName, LlmProvider>>;
  config: AiConfig;
  pricing: Pricing;
  ledger: UsageLedger;
  monthlyBudgetUsd: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface RoutedResult<T> {
  data: T;
  route: ModelRoute;
  estimatedCostUsd: number;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Validated structured output with timeout, retry, fallback, cost logging and a hard budget stop. */
export class AiRouter {
  constructor(private readonly deps: RouterDeps) {}

  async generate<T>(request: StructuredRequest<T>): Promise<RoutedResult<T>> {
    const { config, providers, ledger, monthlyBudgetUsd } = this.deps;
    if ((await ledger.monthSpendUsd()) >= monthlyBudgetUsd) throw new BudgetExceededError();

    const jsonSchema = z.toJSONSchema(request.schema, { target: "draft-7" }) as Record<string, unknown>;
    const attempts: string[] = [];

    for (const route of config.routes[request.feature] ?? []) {
      const provider = providers[route.provider];
      if (!provider) {
        attempts.push(`${route.provider}:not_configured`);
        continue;
      }
      const result = await this.tryRoute(provider, route, request, jsonSchema, attempts);
      if (result) return result;
    }
    throw new AllRoutesFailedError(attempts);
  }

  private async tryRoute<T>(
    provider: LlmProvider,
    route: ModelRoute,
    request: StructuredRequest<T>,
    jsonSchema: Record<string, unknown>,
    attempts: string[],
  ): Promise<RoutedResult<T> | null> {
    const { config, pricing, ledger, sleep = realSleep } = this.deps;

    for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
      const startedAt = Date.now();
      const logFailure = () =>
        ledger.record({
          provider: route.provider, feature: request.feature, model: route.model, inputTokens: null, outputTokens: null,
          characters: null, estimatedCostUsd: 0, latencyMs: Date.now() - startedAt, success: false,
        });

      try {
        const result = await provider.complete({
          model: route.model,
          system: request.system,
          prompt: request.prompt,
          schemaName: request.schemaName,
          jsonSchema,
          maxOutputTokens: request.maxOutputTokens ?? 8000,
          timeoutMs: config.timeoutMs,
        });
        const estimatedCostUsd = estimateCostUsd(pricing, result.model, result.inputTokens, result.outputTokens);
        const parsed = request.schema.safeParse(safeJson(result.text));
        await ledger.record({
          provider: route.provider, feature: request.feature, model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens,
          characters: null, estimatedCostUsd, latencyMs: Date.now() - startedAt, success: parsed.success,
        });
        if (parsed.success) return { data: parsed.data, route: { provider: route.provider, model: result.model }, estimatedCostUsd };
        attempts.push(`${route.provider}:invalid_output`);
        return null;
      } catch (error) {
        await logFailure();
        const failure = error instanceof ProviderError ? error : new ProviderError("unknown", "fallback");
        attempts.push(`${route.provider}:${failure.code}`);
        if (failure.kind === "fatal") throw new AllRoutesFailedError(attempts);
        if (failure.kind === "fallback") return null;
        if (attempt < config.maxRetries) await sleep(500 * 2 ** attempt);
      }
    }
    return null;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Providers enabled by the keys present in the environment. */
export async function providersFromEnv(env: Record<string, string | undefined> = process.env): Promise<RouterDeps["providers"]> {
  const providers: RouterDeps["providers"] = {};
  if (env.ANTHROPIC_API_KEY) providers.anthropic = (await import("./anthropic")).createAnthropicProvider(env.ANTHROPIC_API_KEY);
  if (env.OPENAI_API_KEY) providers.openai = (await import("./openai")).createOpenAiProvider(env.OPENAI_API_KEY);
  if (env.GEMINI_API_KEY) providers.gemini = (await import("./gemini")).createGeminiProvider(env.GEMINI_API_KEY);
  return providers;
}

export type { AiFeature };
