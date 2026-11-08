import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PrivacyStatus, PublicationConfig } from "@/src/core/publication-policy";
import {
  apiErrorCode,
  buildInsertRequest,
  recordedPrivacy,
  UploadRefusedError,
  type FinalizeItem,
  type ProcessingStatus,
  type QueueItem,
  type YoutubeApi,
} from "./youtube";

/** The database side of a publication. Every method maps to one RPC. */
export interface PublicationStore {
  beginUpload(queueId: string): Promise<QueueItem | null>;
  failUpload(queueId: string, error: string): Promise<void>;
  /** Old single-step path, for items queued before covers existed. */
  registerUpload(queueId: string, videoId: string, privacy: PrivacyStatus): Promise<void>;
  /** The video is on YouTube with its final visibility; the cover is still to come. */
  recordVideo(queueId: string, videoId: string, privacy: PrivacyStatus): Promise<void>;
  claimFinalize(queueId: string): Promise<FinalizeItem | null>;
  releaseFinalize(queueId: string, reason: string): Promise<void>;
  failThumbnail(queueId: string, error: string): Promise<void>;
  /** Only after thumbnails.set answered with the new thumbnail. Closes the item. */
  confirmThumbnail(queueId: string): Promise<void>;
  download(storagePath: string): Promise<Uint8Array>;
}

export interface PublishDeps {
  store: PublicationStore;
  api: YoutubeApi;
  config: PublicationConfig;
  workDir: string;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** How long to wait for YouTube's processing in one run; the next run picks it up again. */
  processingChecks?: number;
  processingIntervalMs?: number;
}

export type PublishOutcome =
  | { stage: "nothing" }
  | { stage: "uploaded_without_cover"; videoId: string; privacy: PrivacyStatus }
  | { stage: "waiting_processing"; videoId: string; privacy: PrivacyStatus | null }
  | { stage: "thumbnail_failed"; videoId: string; privacy: PrivacyStatus | null; error: string }
  | { stage: "processing_failed"; videoId: string; reason: string }
  | { stage: "cover_set"; videoId: string; privacy: PrivacyStatus | null };

/** Errors after videos.insert succeeded: the item must stay where it is, never be uploaded again. */
class VideoExistsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VideoExistsError";
  }
}

const codeOf = (error: unknown, fallback: string) =>
  error instanceof UploadRefusedError || (error instanceof Error && /^[a-z_]+(:[\w.-]+)*$/.test(error.message)) ? (error as Error).message : fallback;

async function saveTemp(deps: PublishDeps, storagePath: string, name: string, missing: string): Promise<string> {
  let bytes: Uint8Array;
  try {
    bytes = await deps.store.download(storagePath);
  } catch {
    throw new Error(missing);
  }
  const path = join(deps.workDir, name);
  await writeFile(path, bytes);
  return path;
}

/**
 * Stage one: videos.insert, once, with the visibility decideUpload() allows, so
 * a public video goes out at once and notifies subscribers. The id is recorded
 * right away; from then on begin_upload refuses the item, so no error can lead
 * to a second insert.
 */
async function upload(deps: PublishDeps, item: QueueItem): Promise<PublishOutcome | null> {
  const { store, api, config } = deps;
  const now = (deps.now ?? (() => new Date()))();
  try {
    const request = buildInsertRequest(config, item, now);
    if (!item.storage_path) throw new Error("video_asset_missing");
    const withCover = Boolean(item.thumbnail_asset_id);
    // A queued cover that is gone is caught before the upload, not after.
    if (withCover && !item.thumbnail_path) throw new Error("thumbnail_asset_missing");
    const videoPath = await saveTemp(deps, item.storage_path, `${item.id}.mp4`, "video_download_failed");
    const videoId = await api.insert(request, videoPath).catch((error: unknown) => {
      throw new Error(apiErrorCode("youtube_insert_failed", error));
    });

    const privacy = recordedPrivacy(request.requestBody.status);
    if (!withCover) {
      await store.registerUpload(item.id, videoId, privacy).catch(() => {
        throw new VideoExistsError(`upload_not_registered:${videoId}`);
      });
      return { stage: "uploaded_without_cover", videoId, privacy };
    }
    await store.recordVideo(item.id, videoId, privacy).catch(() => {
      throw new VideoExistsError(`upload_not_registered:${videoId}`);
    });
    return null;
  } catch (error) {
    // The video exists on YouTube: leaving "uploading" in place stops any retry; the id is logged to reconcile.
    if (!(error instanceof VideoExistsError)) await store.failUpload(item.id, codeOf(error, "upload_failed"));
    throw error;
  }
}

/** Processing status, or "unknown" when the token may not read it (videos.list needs more than youtube.upload). */
async function processing(api: YoutubeApi, videoId: string): Promise<ProcessingStatus | "unknown"> {
  try {
    return await api.processingStatus(videoId);
  } catch {
    return "unknown";
  }
}

/**
 * Stage two, repeatable: wait for YouTube's processing (thumbnails.set on a Short
 * works only after it), then set the cover on the video, which already has its
 * final visibility. The item closes only when the API confirms the cover.
 */
async function finalize(deps: PublishDeps, queueId: string): Promise<PublishOutcome> {
  const { store, api } = deps;
  const item = await store.claimFinalize(queueId);
  if (!item) return { stage: "nothing" };
  const videoId = item.youtube_video_id;
  const privacy = item.youtube_privacy ?? null;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const checks = deps.processingChecks ?? 12;
  const interval = deps.processingIntervalMs ?? 15_000;

  let status: ProcessingStatus | "unknown" = "processing";
  for (let check = 0; check < checks; check += 1) {
    if (check > 0) await sleep(interval);
    status = await processing(api, videoId);
    if (status !== "processing") break;
  }
  if (status === "processing") {
    await store.releaseFinalize(queueId, "youtube_processing");
    return { stage: "waiting_processing", videoId, privacy };
  }
  if (status === "failed" || status === "terminated" || status === "missing") {
    const reason = `youtube_processing_${status}`;
    await store.releaseFinalize(queueId, reason);
    return { stage: "processing_failed", videoId, reason };
  }

  let pngPath: string;
  try {
    if (!item.thumbnail_path) throw new Error("thumbnail_asset_missing");
    pngPath = await saveTemp(deps, item.thumbnail_path, `${queueId}.png`, "thumbnail_download_failed");
  } catch (error) {
    const code = codeOf(error, "thumbnail_failed");
    await store.failThumbnail(queueId, code);
    return { stage: "thumbnail_failed", videoId, privacy, error: code };
  }

  // Without a readable status, a few spaced tries stand in for the processing check. They count as one attempt.
  const tries = status === "unknown" ? 4 : 1;
  let code = "thumbnail_failed";
  for (let attempt = 0; attempt < tries; attempt += 1) {
    if (attempt > 0 || status === "unknown") await sleep(Math.max(interval, 30_000));
    try {
      if (await api.setThumbnail(videoId, pngPath)) {
        code = "";
        break;
      }
      code = "thumbnail_not_confirmed";
    } catch (error) {
      code = apiErrorCode("thumbnail_set_failed", error);
    }
  }
  if (code) {
    await store.failThumbnail(queueId, code);
    return { stage: "thumbnail_failed", videoId, privacy, error: code };
  }
  await store.confirmThumbnail(queueId);
  return { stage: "cover_set", videoId, privacy };
}

/** One queue item, wherever it stands: a new upload, or a retry that resumes from the YouTube id already recorded. */
export async function publishQueueItem(deps: PublishDeps, queueId: string): Promise<PublishOutcome> {
  const item = await deps.store.beginUpload(queueId);
  if (item) {
    const done = await upload(deps, item);
    if (done) return done;
  }
  return finalize(deps, queueId);
}
