import { createClient } from "@supabase/supabase-js";
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

/** Reads the cap from a stored budget value; null when it is missing or malformed. */
export function budgetFromSetting(value: unknown): number | null {
  const amount = (value as { monthly_usd?: unknown } | null)?.monthly_usd;
  return typeof amount === "number" && Number.isFinite(amount) && amount >= 0 ? amount : null;
}

/**
 * The monthly cap set in the Studio (app_settings.budget.monthly_usd). The
 * AI_MONTHLY_BUDGET_USD variable is only a fallback when the database has none.
 */
export async function monthlyBudgetUsd(): Promise<number> {
  const env = envSchema.parse(process.env);
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data, error } = await db.from("app_settings").select("value").eq("key", "budget").maybeSingle();
  if (error) throw new Error("budget_unreadable");
  return budgetFromSetting(data?.value) ?? budgetFromEnv(process.env.AI_MONTHLY_BUDGET_USD);
}

/** Fallback cap. `||`, not `??`: GitHub Actions passes an unset variable as an empty string. */
export function budgetFromEnv(raw: string | undefined): number {
  const value = Number(raw || "20");
  if (!Number.isFinite(value) || value < 0) throw new Error("invalid AI_MONTHLY_BUDGET_USD");
  return value;
}

/** Prints only the failure class: job logs are public. */
export function failJob(error: unknown): never {
  console.error(`job failed: ${error instanceof Error ? error.message.slice(0, 200) : "unknown"}`);
  process.exit(1);
}
