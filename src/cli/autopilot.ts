import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { runAdvanceStep, runEditorialStep, uploadIds } from "@/src/pipeline/autopilot";
import { runCompose } from "@/src/pipeline/compose";
import { AiRouter, loadAiConfig, loadPricing, providersFromEnv } from "@/src/providers/router";
import { SupabaseAutopilotStore } from "@/src/store/autopilot";
import { failJob, monthlyBudgetUsd, supabaseStoreFromEnv } from "./shared";

const env = z.object({
  SUPABASE_URL: z.url({ protocol: /^https$/ }),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
});

async function main(): Promise<void> {
  const step = z.enum(["editorial", "advance", "uploads"]).parse(process.argv[process.argv.indexOf("--step") + 1]);
  const vars = env.parse(process.env);
  const store = new SupabaseAutopilotStore(createClient(vars.SUPABASE_URL, vars.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }));

  if (step === "editorial") {
    const editorial = supabaseStoreFromEnv();
    const router = new AiRouter({
      providers: await providersFromEnv(),
      config: loadAiConfig(),
      pricing: loadPricing(),
      ledger: editorial,
      monthlyBudgetUsd: monthlyBudgetUsd(),
    });
    const report = await runEditorialStep(store, async (candidateId) => {
      const result = await runCompose(editorial, router, candidateId);
      return { scriptId: result.scriptId, verdict: result.verdict };
    });
    if (report.action !== "composed") console.log(report.action === "disabled" ? "Pilota automatico spento." : "Nessuna notizia nuova da scrivere ora.");
    else console.log(`Script ${report.scriptId}: ${report.verdict}, ${report.approved ? "approvato in automatico" : "resta nello Studio per una revisione"}.`);
    return;
  }

  if (step === "advance") {
    const report = await runAdvanceStep(store);
    console.log(`Audio in coda: ${report.tts}. Video in coda: ${report.render}. Pubblicazioni in coda: ${report.published}.`);
    for (const error of report.errors) console.log(`Non avanzato: ${error}`);
    return;
  }

  // Only ids on stdout: the workflow loops over them.
  for (const id of await uploadIds(store)) console.log(id);
}

main().catch(failJob);
