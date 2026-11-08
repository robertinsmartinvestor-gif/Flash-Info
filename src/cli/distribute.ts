import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { loadPublicationConfig } from "@/src/core/publication-policy";
import { publishQueueItem, type PublishOutcome } from "@/src/distribution/publish";
import { createYoutubeApi } from "@/src/distribution/youtube";
import { SupabasePublicationStore } from "@/src/store/publication";
import { failJob } from "./shared";

const env = z.object({
  SUPABASE_URL: z.url({ protocol: /^https$/ }),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  YOUTUBE_CLIENT_ID: z.string().min(1),
  YOUTUBE_CLIENT_SECRET: z.string().min(1),
  YOUTUBE_REFRESH_TOKEN: z.string().min(1),
});

// Public log: ids, privacy and error codes only.
function describe(outcome: PublishOutcome): string {
  switch (outcome.stage) {
    case "nothing":
      return "Niente da fare: già gestito, in corso o non approvato.";
    case "uploaded_without_cover":
      return `Caricato senza copertina (voce precedente alle copertine): ${outcome.videoId} (${outcome.privacy})`;
    case "waiting_processing":
      return `In elaborazione su YouTube, resta privato fino al prossimo giro: ${outcome.videoId}`;
    case "thumbnail_failed":
      return `Copertina non accettata, resta privato: ${outcome.videoId} ${outcome.error}`;
    case "held_private":
      return `Resta privato: ${outcome.videoId} ${outcome.reason}`;
    case "published_with_cover":
      return `Copertina confermata da YouTube, visibilità applicata: ${outcome.videoId} (${outcome.privacy})`;
  }
}

async function main(): Promise<void> {
  const queueId = z.uuid().parse(process.argv[process.argv.indexOf("--queue-id") + 1]);
  const vars = env.parse(process.env);
  const config = loadPublicationConfig(process.env);
  const db = createClient(vars.SUPABASE_URL, vars.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const workDir = await mkdtemp(join(tmpdir(), "ogniora-upload-"));
  try {
    const outcome = await publishQueueItem(
      {
        store: new SupabasePublicationStore(db),
        api: createYoutubeApi({ clientId: vars.YOUTUBE_CLIENT_ID, clientSecret: vars.YOUTUBE_CLIENT_SECRET, refreshToken: vars.YOUTUBE_REFRESH_TOKEN }),
        config,
        workDir,
      },
      queueId,
    );
    console.log(describe(outcome));
    // Waiting for YouTube is normal; a refused cover or a video held private needs a look.
    if (outcome.stage === "thumbnail_failed" || outcome.stage === "held_private") process.exitCode = 1;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

main().catch(failJob);
