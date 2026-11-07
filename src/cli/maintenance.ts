import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { failJob, monthlyBudgetUsd } from "./shared";

const env = z.object({ SUPABASE_URL: z.url({ protocol: /^https$/ }), SUPABASE_SERVICE_ROLE_KEY: z.string().min(20) });

async function main(): Promise<void> {
  const vars = env.parse(process.env);
  const db = createClient(vars.SUPABASE_URL, vars.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const stale = await db.rpc("requeue_stale_jobs", { p_stale_minutes: 45 });
  if (stale.error) throw new Error(`requeue:${stale.error.code}`);

  const expired = await db.rpc("expired_media_assets", { p_limit: 100 });
  if (expired.error) throw new Error(`expired:${expired.error.code}`);
  const assets = (expired.data ?? []) as Array<{ id: string; storage_path: string }>;
  if (assets.length) {
    const removed = await db.storage.from("media").remove(assets.map((asset) => asset.storage_path));
    if (removed.error) throw new Error("storage_remove_failed");
    const marked = await db.rpc("mark_media_deleted", { p_ids: assets.map((asset) => asset.id) });
    if (marked.error) throw new Error(`mark_deleted:${marked.error.code}`);
  }

  const retention = await db.rpc("run_retention");
  if (retention.error) throw new Error(`retention:${retention.error.code}`);

  const spend = await db.rpc("provider_spend_usd");
  if (spend.error) throw new Error(`spend:${spend.error.code}`);
  const stuck = await db.from("publication_queue").select("id", { count: "exact", head: true }).eq("status", "uploading");

  console.log(`Job riaccodati: ${stale.data}. Asset eliminati: ${assets.length}. Retention: ${JSON.stringify(retention.data)}.`);
  console.log(`Spesa stimata del mese: $${Number(spend.data).toFixed(2)} su $${monthlyBudgetUsd()}. Upload da controllare: ${stuck.count ?? 0}.`);
}

main().catch(failJob);
