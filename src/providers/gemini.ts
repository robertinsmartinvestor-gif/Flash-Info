import { ApiError, GoogleGenAI } from "@google/genai";
import { classifyStatus, type LlmProvider, type StructuredCall, type StructuredResult } from "./types";

export function createGeminiProvider(apiKey: string): LlmProvider {
  const client = new GoogleGenAI({ apiKey });

  return {
    name: "gemini",
    async complete(call: StructuredCall): Promise<StructuredResult> {
      try {
        const response = await client.models.generateContent({
          model: call.model,
          contents: call.prompt,
          config: {
            systemInstruction: call.system,
            maxOutputTokens: call.maxOutputTokens,
            responseMimeType: "application/json",
            responseJsonSchema: call.jsonSchema,
            httpOptions: { timeout: call.timeoutMs },
          },
        });
        return {
          text: response.text ?? "",
          model: call.model,
          inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
        };
      } catch (error) {
        throw classifyStatus(error instanceof ApiError ? error.status : undefined);
      }
    },
  };
}
