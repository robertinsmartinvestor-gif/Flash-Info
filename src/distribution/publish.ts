import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PrivacyStatus, PublicationConfig } from "@/src/core/publication-policy";
import {
  apiErrorCode,
  buildInsertRequest,
  FINALIZE_SCOPES,
  finalVisibility,
  recordedPrivacy,
  UploadRefusedError,
  type FinalizeItem,
  type QueueItem,
  type YoutubeApi,
} from "./youtube";

/** The database side of a publication. Every method maps to one RPC. */
export interface PublicationStore {
  beginUpload(queueId: string): Promise<QueueItem | null>;
  failUpload(queueId: string, error: string): Promise<void>;
  /** Old single-step path, for items queued before covers existed. */
  registerUpload(queueId: string, videoId: string, privacy: PrivacyStatus): Promise<void>;
  recordVideo(queueId: string, videoId: string): Promise<void>;
  claimFinalize(queueId: string): Promise<FinalizeItem | null>;
  releaseFinalize(queueId: string, reason: string): Promise<void>;
  failThumbnail(queueId: string, error: string): Promise<void>;
  confirmThumbnail(queueId: string): Promise<void>;
  completePublication(queueId: string, privacy: PrivacyStatus): Promise<void>;
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
  | { stage: "waiting_processing"; videoId: string }
  | { stage: "thumbnail_failed"; videoId: string; error: string }
  | { stage: "held_private"; videoId: string; reason: string }
  | { stage: "published_with_cover"; videoId: string; privacy: PrivacyStatus };

/** Errors after videos.insert succeeded carry this flag: the item must stay where it is, never be uploaded again. */
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
 * Stage one: videos.insert, once. An item with a cover goes up private and its
 * id is recorded at once; from then on begin_upload refuses it, so no error can
 * lead to a second insert.
 */
async function upload(deps: PublishDeps, item: QueueItem): Promise<PublishOutcome | null> {
  const { store, api, config } = deps;
  const now = (deps.now ?? (() => new Date()))();
  try {
    const request = buildInsertRequest(config, item, now);
    if (!item.storage_path) throw new Error("video_asset_missing");
    const withCover = Boolean(item.thumbnail_asset_id);
    if (withCover) {
      if (!item.thumbnail_path) throw new Error("thumbnail_asset_missing");
      // Checked before the insert: without these scopes the video would stay private with no way to finish it.
      const scopes = await api.grantedScopes().catch(() => [] as string[]);
      if (!scopes.some((scope) => FINALIZE_SCOPES.includes(scope))) throw new Error("youtube_scope_missing");
    }
    const videoPath = await saveTemp(deps, item.storage_path, `${item.id}.mp4`, "video_download_failed");
    const videoId = await api.insert(request, videoPath).catch((error: unknown) => {
      throw new Error(apiErrorCode("youtube_insert_failed", error));
    });

    if (!withCover) {
      const privacy = recordedPrivacy(request.requestBody.status);
      await store.registerUpload(item.id, videoId, privacy).catch(() => {
        throw new VideoExistsError(`upload_not_registered:${videoId}`);
      });
      return { stage: "uploaded_without_cover", videoId, privacy };
    }
    await store.recordVideo(item.id, videoId).catch(() => {
      throw new VideoExistsError(`upload_not_registered:${videoId}`);
    });
    return null;
  } catch (error) {
    // The video exists on YouTube: leaving "uploading" in place stops any retry; the id is logged to reconcile.
    if (!(error instanceof VideoExistsError)) await store.failUpload(item.id, codeOf(error, "upload_failed"));
    throw error;
  }
}

/**
 * Stage two, repeatable: wait for processing, set the cover, then apply the
 * visibility decideUpload() allows. The video stays private until the API has
 * confirmed the cover.
 */
async function finalize(deps: PublishDeps, queueId: string): Promise<PublishOutcome> {
  const { store, api, config } = deps;
  const item = await store.claimFinalize(queueId);
  if (!item) return { stage: "nothing" };
  const videoId = item.youtube_video_id;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  let processing: string = "processing";
  for (let check = 0; check < (deps.processingChecks ?? 12); check += 1) {
    if (check > 0) await sleep(deps.processingIntervalMs ?? 15_000);
    processing = await api.processingStatus(videoId).catch((error: unknown) => apiErrorCode("youtube_list_failed", error));
    if (processing !== "processing") break;
  }
  if (processing === "processing") {
    await store.releaseFinalize(queueId, "youtube_processing");
    return { stage: "waiting_processing", videoId };
  }
  if (processing !== "succeeded") {
    const reason = processing.startsWith("youtube_") ? processing : `youtube_processing_${processing}`;
    await store.releaseFinalize(queueId, reason);
    return { stage: "held_private", videoId, reason };
  }

  if (item.thumbnail_status !== "set") {
    try {
      if (!item.thumbnail_path) throw new Error("thumbnail_asset_missing");
      const pngPath = await saveTemp(deps, item.thumbnail_path, `${queueId}.png`, "thumbnail_download_failed");
      const confirmed = await api.setThumbnail(videoId, pngPath).catch((error: unknown) => {
        throw new Error(apiErrorCode("thumbnail_set_failed", error));
      });
      if (!confirmed) throw new Error("thumbnail_not_confirmed");
    } catch (error) {
      const code = codeOf(error, "thumbnail_failed");
      await store.failThumbnail(queueId, code);
      return { stage: "thumbnail_failed", videoId, error: code };
    }
    await store.confirmThumbnail(queueId);
  }

  // The policy is applied again here: an authorization withdrawn meanwhile keeps the video private.
  let status;
  try {
    status = finalVisibility(config, item, (deps.now ?? (() => new Date()))());
  } catch (error) {
    const reason = codeOf(error, "visibility_refused");
    await store.releaseFinalize(queueId, reason);
    return { stage: "held_private", videoId, reason };
  }
  if (status.privacyStatus !== "private" || status.publishAt) {
    try {
      await api.updateStatus(videoId, status);
    } catch (error) {
      const reason = apiErrorCode("visibility_update_failed", error);
      await store.releaseFinalize(queueId, reason);
      return { stage: "held_private", videoId, reason };
    }
  }
  const privacy = recordedPrivacy(status);
  await store.completePublication(queueId, privacy);
  return { stage: "published_with_cover", videoId, privacy };
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
