import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { checkThumbnailFile, parseThumbnailInput } from "@/src/distribution/manual-thumbnail";
import { apiErrorCode, createYoutubeApi } from "@/src/distribution/youtube";
import { failJob } from "./shared";

const env = z.object({
  SUPABASE_URL: z.url({ protocol: /^https$/ }),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  YOUTUBE_CLIENT_ID: z.string().min(1),
  YOUTUBE_CLIENT_SECRET: z.string().min(1),
  YOUTUBE_REFRESH_TOKEN: z.string().min(1),
});

const arg = (name: string) => process.argv[process.argv.indexOf(name) + 1] ?? "";

/**
 * Sets a cover by hand on a video already on YouTube: a replacement chosen by a
 * person, or a cover the autopilot gave up on. The PNG comes from the private
 * bucket; visibility is never touched.
 */
async function main(): Promise<void> {
  const { videoId, storagePath } = parseThumbnailInput(arg("--video-id"), arg("--path"));
  const vars = env.parse(process.env);
  const db = createClient(vars.SUPABASE_URL, vars.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const file = await db.storage.from("media").download(storagePath);
  if (file.error) throw new Error("thumbnail_download_failed");
  const bytes = new Uint8Array(await file.data.arrayBuffer());
  const problem = checkThumbnailFile(bytes);
  if (problem) throw new Error(problem);

  const dir = await mkdtemp(join(tmpdir(), "ogniora-thumbnail-"));
  try {
    const path = join(dir, "cover.png");
    await writeFile(path, bytes);
    const api = createYoutubeApi({ clientId: vars.YOUTUBE_CLIENT_ID, clientSecret: vars.YOUTUBE_CLIENT_SECRET, refreshToken: vars.YOUTUBE_REFRESH_TOKEN });
    const confirmed = await api.setThumbnail(videoId, path).catch((error: unknown) => {
      throw new Error(apiErrorCode("thumbnail_set_failed", error));
    });
    if (!confirmed) throw new Error("thumbnail_not_confirmed");
    console.log(`Copertina confermata da YouTube: ${videoId}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

main().catch(failJob);
