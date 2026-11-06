import Anthropic from "@anthropic-ai/sdk";
import { classifyStatus, ProviderError, type LlmProvider, type StructuredCall, type StructuredResult } from "./types";

/** Models that accept the server-side refusal fallback. */
const SERVER_FALLBACK_MODELS = new Set(["claude-sonnet-5-5", "claude-opus-5-5"]);

export function createAnthropicProvider(apiKey: string): LlmProvider {
  const client = new Anthropic({ apiKey, maxRetries: 0 });

  return {
    name: "anthropic",
    async complete(call: StructuredCall): Promise<StructuredResult> {
      const request = {
        model: call.model,
        max_tokens: call.maxOutputTokens,
        system: call.system,
        messages: [{ role: "user" as const, content: call.prompt }],
        output_config: { format: { type: "json_schema" as const, schema: call.jsonSchema } },
      };

      try {
        const response = SERVER_FALLBACK_MODELS.has(call.model)
          ? await client.beta.messages.create(
              { ...request, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } as Parameters<typeof client.beta.messages.create>[0] & { stream?: false },
              { timeout: call.timeoutMs },
            )
          : await client.messages.create(request, { timeout: call.timeoutMs });

        if (response.stop_reason === "refusal") throw new ProviderError("refusal", "fallback");
        if (response.stop_reason === "max_tokens") throw new ProviderError("max_tokens", "fallback");

        const text = response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
        return {
          text,
          model: response.model,
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        };
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        throw classifyStatus(error instanceof Anthropic.APIError ? error.status : undefined);
      }
    },
  };
}
