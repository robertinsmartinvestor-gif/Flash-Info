import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { runTtsJobs } from "@/src/pipeline/tts-job";
import { SupabaseProductionStore } from "@/src/store/production";
import { failJob, monthlyBudgetUsd } from "./shared";
import { synthesizersFromEnv } from "./tts-providers";

const env = z.object({
  SUPABASE_URL: z.url({ protocol: /^https$/ }),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  GITHUB_RUN_ID: z.string().regex(/^\d+$/),
});

async function main(): Promise<void> {
  const vars = env.parse(process.env);
  const db = createClient(vars.SUPABASE_URL, vars.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const outcomes = await runTtsJobs({
    store: new SupabaseProductionStore(db),
    synthesizers: synthesizersFromEnv(),
    monthlyBudgetUsd: monthlyBudgetUsd(),
    runnerId: `actions-${vars.GITHUB_RUN_ID}`,
  });
  // Public log: ids and codes only, never the narration or a signed URL.
  if (!outcomes.length) console.log("Nessun job audio in coda.");
  for (const outcome of outcomes) {
    console.log(`${outcome.jobId} ${outcome.status}${outcome.status === "failed" ? ` ${outcome.errorCode}` : ""}`);
  }
  if (outcomes.some((outcome) => outcome.status === "failed")) process.exitCode = 1;
}

main().catch(failJob);
