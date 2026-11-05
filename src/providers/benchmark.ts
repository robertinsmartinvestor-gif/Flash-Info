import { z } from "zod";
import { FORMATS, type FormatId } from "@/src/editorial/formats";
import { buildPrompt } from "@/src/editorial/generate";
import { scriptDraftSchema, type EvidenceItem } from "@/src/editorial/schema";
import { runQualityChecks, type Verdict } from "@/src/quality/checks";
import { estimateCostUsd, type Pricing } from "./router";
import type { LlmProvider, ModelRoute } from "./types";

export interface BenchmarkRow {
  route: string;
  ok: boolean;
  verdict: Verdict | "error";
  blockers: number;
  words: number;
  latencyMs: number;
  costUsd: number;
  error: string | null;
}

/**
 * Compares models on the same closed evidence pack. Accuracy here means how much
 * of the output survives the deterministic QC. Italian quality still needs a
 * human read: the narration is returned for that.
 */
export async function benchmarkRoute(
  provider: LlmProvider,
  route: ModelRoute,
  system: string,
  pack: EvidenceItem[],
  formatId: FormatId,
  now: Date,
  pricing: Pricing,
): Promise<{ row: BenchmarkRow; narration: string }> {
  const label = `${route.provider}:${route.model}`;
  const startedAt = Date.now();
  try {
    const result = await provider.complete({
      model: route.model,
      system,
      prompt: buildPrompt(pack, FORMATS[formatId], now),
      schemaName: "script_draft",
      jsonSchema: z.toJSONSchema(scriptDraftSchema, { target: "draft-7" }) as Record<string, unknown>,
      maxOutputTokens: 8000,
      timeoutMs: 90_000,
    });
    const draft = scriptDraftSchema.parse(JSON.parse(result.text));
    const report = runQualityChecks(draft, pack, FORMATS[formatId], now);
    const narration = draft.sentences.map((sentence) => sentence.text).join(" ");
    return {
      narration,
      row: {
        route: label,
        ok: true,
        verdict: report.verdict,
        blockers: report.findings.filter((finding) => finding.severity === "blocker").length,
        words: narration.split(/\s+/).length,
        latencyMs: Date.now() - startedAt,
        costUsd: estimateCostUsd(pricing, result.model, result.inputTokens, result.outputTokens),
        error: null,
      },
    };
  } catch (error) {
    return {
      narration: "",
      row: {
        route: label, ok: false, verdict: "error", blockers: 0, words: 0, latencyMs: Date.now() - startedAt, costUsd: 0,
        error: error instanceof Error ? error.message.slice(0, 80) : "unknown",
      },
    };
  }
}
