import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { loadPublicationConfig } from "@/src/core/publication-policy";
import { buildInsertRequest, uploadVideo, type QueueItem } from "@/src/distribution/youtube";
import { failJob } from "./shared";

const env = z.object({
  SUPABASE_URL: z.url({ protocol: /^https$/ }),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  YOUTUBE_CLIENT_ID: z.string().min(1),
  YOUTUBE_CLIENT_SECRET: z.string().min(1),
  YOUTUBE_REFRESH_TOKEN: z.string().min(1),
});

async function main(): Promise<void> {
  const queueId = z.uuid().parse(process.argv[process.argv.indexOf("--queue-id") + 1]);
  const vars = env.parse(process.env);
  const config = loadPublicationConfig(process.env);
  const db = createClient(vars.SUPABASE_URL, vars.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const { data, error } = await db.rpc("begin_upload", { p_queue_id: queueId });
  if (error) throw new Error(`begin_upload:${error.code}`);
  if (!data) {
    console.log("Niente da caricare: già gestito, in corso o non approvato.");
    return;
  }
  const item = data as QueueItem;

  try {
    const request = buildInsertRequest(config, item);
    if (!item.storage_path) throw new Error("video_asset_missing");
    const file = await db.storage.from("media").download(item.storage_path);
    if (file.error) throw new Error("video_download_failed");
    const videoPath = join(tmpdir(), `${queueId}.mp4`);
    await writeFile(videoPath, Buffer.from(await file.data.arrayBuffer()));

    const videoId = await uploadVideo(
      { clientId: vars.YOUTUBE_CLIENT_ID, clientSecret: vars.YOUTUBE_CLIENT_SECRET, refreshToken: vars.YOUTUBE_REFRESH_TOKEN },
      request,
      videoPath,
    );
    const privacy = request.requestBody.status.publishAt ? "public" : request.requestBody.status.privacyStatus;
    const registered = await db.rpc("register_youtube_upload", { p_queue_id: queueId, p_video_id: videoId, p_privacy: privacy });
    // The video exists: leaving "uploading" in place stops any retry. The id is logged to reconcile by hand.
    if (registered.error) throw Object.assign(new Error(`upload_not_registered:${videoId}`), { keepUploading: true });
    console.log(`Caricato: ${videoId} (${privacy})`);
  } catch (error) {
    const keep = (error as { keepUploading?: boolean }).keepUploading === true;
    if (!keep) await db.rpc("fail_upload", { p_queue_id: queueId, p_error: error instanceof Error ? error.message : "unknown" });
    throw error;
  }
}

main().catch(failJob);
