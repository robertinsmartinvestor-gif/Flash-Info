import type { z } from "zod";

export type ProviderName = "anthropic" | "openai" | "gemini";
export type AiFeature = "script" | "verify";

export interface ModelRoute {
  provider: ProviderName;
  model: string;
}

export interface StructuredCall {
  model: string;
  system: string;
  prompt: string;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  maxOutputTokens: number;
  timeoutMs: number;
}

export interface StructuredResult {
  text: string;
  /** Model that really served the request, which a server-side fallback may change. */
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface LlmProvider {
  readonly name: ProviderName;
  complete(call: StructuredCall): Promise<StructuredResult>;
}

export type ProviderErrorKind = "retryable" | "fallback" | "fatal";

/** `retryable`: try the same route again. `fallback`: try the next route. `fatal`: stop. */
export class ProviderError extends Error {
  constructor(
    readonly code: string,
    readonly kind: ProviderErrorKind,
  ) {
    super(code);
    this.name = "ProviderError";
  }
}

export function classifyStatus(status: number | undefined): ProviderError {
  if (status === 429 || status === 408 || status === 409 || (status !== undefined && status >= 500)) {
    return new ProviderError(`http_${status}`, "retryable");
  }
  if (status === 401 || status === 403 || status === 404 || status === 400) {
    return new ProviderError(`http_${status}`, "fallback");
  }
  return new ProviderError("network", "retryable");
}

export interface UsageRecord {
  provider: string;
  feature: string;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  characters: number | null;
  estimatedCostUsd: number;
  latencyMs: number;
  success: boolean;
}

export interface UsageLedger {
  record(usage: UsageRecord): Promise<void>;
  monthSpendUsd(): Promise<number>;
}

export interface StructuredRequest<T> {
  feature: AiFeature;
  schemaName: string;
  schema: z.ZodType<T>;
  system: string;
  prompt: string;
  maxOutputTokens?: number;
}
