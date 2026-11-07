import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { assignLabels, PRONUNCIATION_SAMPLE, runListeningTest, TEST_VOICES, testCostUsd } from "@/src/media/listening-test";
import { failJob } from "./shared";
import { synthesizersFromEnv } from "./tts-providers";

const env = z.object({
  SUPABASE_URL: z.url({ protocol: /^https$/ }),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  GITHUB_RUN_ID: z.string().regex(/^\d+$/),
});

async function main(): Promise<void> {
  const vars = env.parse(process.env);
  const db = createClient(vars.SUPABASE_URL, vars.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const synthesizers = synthesizersFromEnv();
  if (!Object.keys(synthesizers).length) throw new Error("no_tts_credentials");

  const latest = await db
    .from("script_versions")
    .select("script_id, narration")
    .eq("qc_verdict", "needs_review")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest.error) throw new Error(`script:${latest.error.code}`);
  if (!latest.data) throw new Error("no_script_to_read");
  const { script_id: scriptId, narration } = latest.data;

  const folder = `listening-test/${vars.GITHUB_RUN_ID}`;
  const results = await runListeningTest({
    voices: assignLabels(TEST_VOICES),
    samples: [
      { id: "script", text: narration },
      { id: "pronuncia", text: PRONUNCIATION_SAMPLE },
    ],
    synthesizers,
    save: async (fileName, audio) => {
      const upload = await db.storage.from("media").upload(`${folder}/${fileName}`, audio, { contentType: "audio/mpeg" });
      if (upload.error) throw new Error("tts_storage_upload");
    },
  });

  const spent = results.filter((result) => result.characters > 0);
  if (spent.length) {
    const usage = await db.from("provider_usage").insert(
      spent.map((result) => ({
        provider: result.provider,
        feature: "listening_test",
        model: result.voice,
        characters: result.characters,
        estimated_cost_usd: testCostUsd([result]),
        success: true,
        script_id: scriptId,
      })),
    );
    if (usage.error) throw new Error(`usage:${usage.error.code}`);
  }

  // Public log: labels and failure codes only, never the text or a signed URL.
  for (const result of results) {
    console.log(`${result.label} ${result.sample} ${result.status}${result.reason ? ` ${result.reason}` : ""}`);
  }
  const key = [...new Map(results.map((result) => [result.label, `${result.label}=${result.provider}:${result.voice}`])).values()].join(" ");
  console.log(`Chiave del test (non leggerla prima di votare): ${key}`);
  console.log(`Cartella: ${folder}. Costo a listino: $${testCostUsd(results).toFixed(4)}.`);
  if (!results.some((result) => result.status === "ok")) throw new Error("all_voices_failed");
}

main().catch(failJob);
