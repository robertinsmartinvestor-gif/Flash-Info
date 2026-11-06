import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SYSTEM_PROMPT } from "@/src/editorial/generate";
import type { EvidenceItem } from "@/src/editorial/schema";
import { benchmarkRoute } from "@/src/providers/benchmark";
import { loadPricing, providersFromEnv } from "@/src/providers/router";
import type { ModelRoute, ProviderName } from "@/src/providers/types";
import { failJob } from "./shared";

/** Spends real money: every route in BENCHMARK_ROUTES is called once per run. */
async function main(): Promise<void> {
  const routes: ModelRoute[] = (process.env.BENCHMARK_ROUTES ?? "").split(",").filter(Boolean).map((entry) => {
    const [provider, ...model] = entry.trim().split(":");
    return { provider: provider as ProviderName, model: model.join(":") };
  });
  if (routes.length === 0) throw new Error("set BENCHMARK_ROUTES=provider:model,provider:model");

  const { now, evidence } = JSON.parse(readFileSync(join(process.cwd(), "config", "benchmark-pack.json"), "utf8")) as { now: string; evidence: EvidenceItem[] };
  const providers = await providersFromEnv();
  const pricing = loadPricing();

  for (const route of routes) {
    const provider = providers[route.provider];
    if (!provider) {
      console.log(`${route.provider}:${route.model} saltato: chiave assente`);
      continue;
    }
    const { row, narration } = await benchmarkRoute(provider, route, SYSTEM_PROMPT, evidence, "flash", new Date(now), pricing);
    console.log(JSON.stringify(row));
    if (narration) console.log(`  ${narration}\n`);
  }
}

main().catch(failJob);
