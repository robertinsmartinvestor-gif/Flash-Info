import { z } from "zod";
import { SupabaseStore } from "@/src/store/supabase";

const envSchema = z.object({
  SUPABASE_URL: z.url({ protocol: /^https$/ }),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
});

export function supabaseStoreFromEnv(): SupabaseStore {
  const env = envSchema.parse(process.env);
  return new SupabaseStore(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
}

export function monthlyBudgetUsd(): number {
  const value = Number(process.env.AI_MONTHLY_BUDGET_USD ?? "20");
  if (!Number.isFinite(value) || value <= 0) throw new Error("invalid AI_MONTHLY_BUDGET_USD");
  return value;
}

/** Prints only the failure class: job logs are public. */
export function failJob(error: unknown): never {
  console.error(`job failed: ${error instanceof Error ? error.message.slice(0, 200) : "unknown"}`);
  process.exit(1);
}
