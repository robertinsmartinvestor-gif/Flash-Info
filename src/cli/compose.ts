import { z } from "zod";
import { runCompose } from "@/src/pipeline/compose";
import { AiRouter, loadAiConfig, loadPricing, providersFromEnv } from "@/src/providers/router";
import { failJob, monthlyBudgetUsd, supabaseStoreFromEnv } from "./shared";

async function main(): Promise<void> {
  const candidateId = z.uuid().parse(process.argv[process.argv.indexOf("--candidate-id") + 1]);
  const store = supabaseStoreFromEnv();
  const router = new AiRouter({
    providers: await providersFromEnv(),
    config: loadAiConfig(),
    pricing: loadPricing(),
    ledger: store,
    monthlyBudgetUsd: monthlyBudgetUsd(),
  });
  const result = await runCompose(store, router, candidateId);
  console.log(`Script ${result.scriptId} v${result.version}: ${result.verdict}, ${result.findings} rilievi.`);
}

main().catch(failJob);
