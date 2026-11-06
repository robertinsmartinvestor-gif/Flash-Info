import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { benchmarkRoute } from "@/src/providers/benchmark";
import type { LlmProvider } from "@/src/providers/types";
import { NOW, PACK, validDraft } from "../helpers/fixtures";

const route = { provider: "anthropic" as const, model: "m" };
const pricing = { m: { input: 1, output: 1 } };

function provider(text: string): LlmProvider {
  return { name: "anthropic", complete: async () => ({ text, model: "m", inputTokens: 1000, outputTokens: 1000 }) };
}

describe("benchmarkRoute", () => {
  it("scores a good output", async () => {
    const { row, narration } = await benchmarkRoute(provider(JSON.stringify(validDraft())), route, "s", PACK, "flash", NOW, pricing);
    expect(row).toMatchObject({ ok: true, verdict: "pass", blockers: 0, costUsd: 0.002 });
    expect(narration).toContain("Salvini");
  });

  it("reports a broken output instead of stopping the comparison", async () => {
    const { row } = await benchmarkRoute(provider("not json"), route, "s", PACK, "flash", NOW, pricing);
    expect(row).toMatchObject({ ok: false, verdict: "error" });
  });

  it("ships a pack the checks can read", () => {
    const { evidence } = JSON.parse(readFileSync("config/benchmark-pack.json", "utf8")) as { evidence: unknown[] };
    expect(evidence).toHaveLength(3);
  });
});
