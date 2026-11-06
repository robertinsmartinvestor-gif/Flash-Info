import OpenAI from "openai";
import { classifyStatus, type LlmProvider, type StructuredCall, type StructuredResult } from "./types";

export function createOpenAiProvider(apiKey: string): LlmProvider {
  const client = new OpenAI({ apiKey, maxRetries: 0 });

  return {
    name: "openai",
    async complete(call: StructuredCall): Promise<StructuredResult> {
      try {
        const response = await client.responses.create(
          {
            model: call.model,
            instructions: call.system,
            input: call.prompt,
            max_output_tokens: call.maxOutputTokens,
            text: { format: { type: "json_schema", name: call.schemaName, schema: call.jsonSchema, strict: true } },
          },
          { timeout: call.timeoutMs },
        );
        return {
          text: response.output_text,
          model: response.model,
          inputTokens: response.usage?.input_tokens ?? 0,
          outputTokens: response.usage?.output_tokens ?? 0,
        };
      } catch (error) {
        throw classifyStatus(error instanceof OpenAI.APIError ? error.status : undefined);
      }
    },
  };
}

export async function embedTexts(apiKey: string, texts: string[], model = "text-embedding-3-small"): Promise<{ vectors: number[][]; tokens: number }> {
  const client = new OpenAI({ apiKey, maxRetries: 1 });
  const response = await client.embeddings.create({ model, input: texts });
  return { vectors: response.data.map((item) => item.embedding), tokens: response.usage.total_tokens };
}
