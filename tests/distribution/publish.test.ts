import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadPublicationConfig } from "@/src/core/publication-policy";
import { publishQueueItem, type PublicationStore, type PublishDeps } from "@/src/distribution/publish";
import type { FinalizeItem, QueueItem, YoutubeApi } from "@/src/distribution/youtube";

const NOW = new Date("2026-11-08T07:05:00Z");
const live = loadPublicationConfig({ ALLOW_PUBLIC_PUBLICATION: "true", OGNIORA_ENV: "production", PUBLICATION_MODE: "automatic" });
const safe = loadPublicationConfig({});
const SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.force-ssl"];

const queued = (overrides: Partial<QueueItem> = {}): QueueItem => ({
  id: "q1", privacy: "public", publish_at: null, contains_synthetic_media: true, title: "T", description: "D", tags: [],
  public_authorized_by: null, public_authorized_at: "2026-11-08T07:00:00Z", storage_path: "video/v1/flash-v1.mp4", script_approved: true,
  thumbnail_asset_id: "thumb-1", thumbnail_path: "thumbnail/v1/cover-v1.png", ...overrides,
});
const onYoutube = (overrides: Partial<FinalizeItem> = {}): FinalizeItem => ({
  ...queued(), youtube_video_id: "yt-1", thumbnail_status: "pending", thumbnail_attempts: 0, ...overrides,
});

/** A store that keeps the real state machine: begin_upload refuses an item once its video id is recorded. */
function fakeStore(item: QueueItem | null = queued(), overrides: Partial<PublicationStore> = {}) {
  let videoId: string | null = null;
  let thumbnailStatus: FinalizeItem["thumbnail_status"] = "pending";
  const store = {
    beginUpload: vi.fn(async () => (videoId || !item ? null : item)),
    failUpload: vi.fn(async () => undefined),
    registerUpload: vi.fn(async () => undefined),
    recordVideo: vi.fn(async (_id: string, id: string) => {
      videoId = id;
    }),
    claimFinalize: vi.fn(async (): Promise<FinalizeItem | null> =>
      videoId && item ? { ...item, youtube_video_id: videoId, thumbnail_status: thumbnailStatus, thumbnail_attempts: 0 } : null),
    releaseFinalize: vi.fn(async () => undefined),
    failThumbnail: vi.fn(async () => undefined),
    confirmThumbnail: vi.fn(async () => {
      thumbnailStatus = "set";
    }),
    completePublication: vi.fn(async () => undefined),
    download: vi.fn(async () => new Uint8Array([1, 2, 3])),
    ...overrides,
  } satisfies PublicationStore;
  return store;
}

function fakeApi(overrides: Partial<YoutubeApi> = {}) {
  return {
    grantedScopes: vi.fn(async () => SCOPES),
    insert: vi.fn(async () => "yt-1"),
    processingStatus: vi.fn(async () => "succeeded" as const),
    setThumbnail: vi.fn(async () => true),
    updateStatus: vi.fn(async () => undefined),
    ...overrides,
  } satisfies YoutubeApi;
}

const deps = (store: PublicationStore, api: YoutubeApi, overrides: Partial<PublishDeps> = {}): PublishDeps => ({
  store, api, config: live, workDir: mkdtempSync(join(tmpdir(), "publish-test-")), now: () => NOW, sleep: vi.fn(async () => undefined), ...overrides,
});

describe("publishQueueItem", () => {
  it("uploads private, confirms the cover, then applies the public visibility", async () => {
    const store = fakeStore();
    const api = fakeApi();
    await expect(publishQueueItem(deps(store, api), "q1")).resolves.toEqual({ stage: "published_with_cover", videoId: "yt-1", privacy: "public" });

    const request = vi.mocked(api.insert).mock.calls[0]?.[0];
    expect(request?.requestBody.status).toEqual({ privacyStatus: "private", selfDeclaredMadeForKids: false, containsSyntheticMedia: true });
    expect(request?.notifySubscribers).toBe(false);
    expect(store.recordVideo).toHaveBeenCalledWith("q1", "yt-1");
    expect(api.setThumbnail).toHaveBeenCalledWith("yt-1", expect.stringMatching(/q1\.png$/));
    expect(store.download).toHaveBeenCalledWith("thumbnail/v1/cover-v1.png");
    expect(api.updateStatus).toHaveBeenCalledWith("yt-1", { privacyStatus: "public", selfDeclaredMadeForKids: false, containsSyntheticMedia: true });
    expect(store.completePublication).toHaveBeenCalledWith("q1", "public");

    // The order that keeps the video private until the API confirmed the cover.
    const order = (fn: unknown) => vi.mocked(fn as () => unknown).mock.invocationCallOrder[0]!;
    expect(order(api.insert)).toBeLessThan(order(store.recordVideo));
    expect(order(store.recordVideo)).toBeLessThan(order(api.setThumbnail));
    expect(order(api.setThumbnail)).toBeLessThan(order(store.confirmThumbnail));
    expect(order(store.confirmThumbnail)).toBeLessThan(order(api.updateStatus));
    expect(order(api.updateStatus)).toBeLessThan(order(store.completePublication));
  });

  it("leaves the video private while YouTube is still processing, and does not count it as a cover failure", async () => {
    const store = fakeStore();
    const api = fakeApi({ processingStatus: vi.fn(async () => "processing" as const) });
    const d = deps(store, api, { processingChecks: 3 });
    await expect(publishQueueItem(d, "q1")).resolves.toEqual({ stage: "waiting_processing", videoId: "yt-1" });
    expect(api.processingStatus).toHaveBeenCalledTimes(3);
    expect(d.sleep).toHaveBeenCalledTimes(2);
    expect(store.releaseFinalize).toHaveBeenCalledWith("q1", "youtube_processing");
    expect(api.setThumbnail).not.toHaveBeenCalled();
    expect(api.updateStatus).not.toHaveBeenCalled();
    expect(store.failThumbnail).not.toHaveBeenCalled();
  });

  it("records a refused cover apart from the upload and keeps the video private", async () => {
    const error = Object.assign(new Error("The authenticated user doesn't have permissions"), { code: 403, errors: [{ reason: "forbidden" }] });
    const store = fakeStore();
    const api = fakeApi({ setThumbnail: vi.fn(async () => { throw error; }) });
    await expect(publishQueueItem(deps(store, api), "q1")).resolves.toEqual({ stage: "thumbnail_failed", videoId: "yt-1", error: "thumbnail_set_failed:403:forbidden" });
    expect(store.failThumbnail).toHaveBeenCalledWith("q1", "thumbnail_set_failed:403:forbidden");
    expect(store.failUpload).not.toHaveBeenCalled();
    expect(store.confirmThumbnail).not.toHaveBeenCalled();
    expect(api.updateStatus).not.toHaveBeenCalled();
    expect(store.completePublication).not.toHaveBeenCalled();
  });

  it("does not take an answer without the new thumbnail as a confirmation", async () => {
    const store = fakeStore();
    const api = fakeApi({ setThumbnail: vi.fn(async () => false) });
    await expect(publishQueueItem(deps(store, api), "q1")).resolves.toMatchObject({ stage: "thumbnail_failed", error: "thumbnail_not_confirmed" });
    expect(api.updateStatus).not.toHaveBeenCalled();
  });

  it("retries from the YouTube id already recorded, never inserting the video twice", async () => {
    const store = fakeStore();
    const failing = vi.fn().mockRejectedValueOnce(Object.assign(new Error("x"), { code: 429, errors: [{ reason: "uploadRateLimitExceeded" }] })).mockResolvedValue(true);
    const api = fakeApi({ setThumbnail: failing });
    await expect(publishQueueItem(deps(store, api), "q1")).resolves.toMatchObject({ stage: "thumbnail_failed" });
    await expect(publishQueueItem(deps(store, api), "q1")).resolves.toEqual({ stage: "published_with_cover", videoId: "yt-1", privacy: "public" });
    expect(api.insert).toHaveBeenCalledTimes(1);
    expect(api.setThumbnail).toHaveBeenCalledTimes(2);
    expect(api.updateStatus).toHaveBeenCalledTimes(1);
  });

  it("does not set a confirmed cover again when only the visibility is left", async () => {
    const store = fakeStore(null, { claimFinalize: vi.fn(async () => onYoutube({ thumbnail_status: "set" })) });
    const api = fakeApi();
    await expect(publishQueueItem(deps(store, api), "q1")).resolves.toMatchObject({ stage: "published_with_cover" });
    expect(api.insert).not.toHaveBeenCalled();
    expect(api.setThumbnail).not.toHaveBeenCalled();
    expect(api.updateStatus).toHaveBeenCalledTimes(1);
  });

  it("keeps the item in 'uploading' when the id cannot be recorded, so no retry uploads it again", async () => {
    const store = fakeStore(queued(), { recordVideo: vi.fn(async () => { throw new Error("record_youtube_video:P0001"); }) });
    const api = fakeApi();
    await expect(publishQueueItem(deps(store, api), "q1")).rejects.toThrow("upload_not_registered:yt-1");
    expect(store.failUpload).not.toHaveBeenCalled();
    expect(api.setThumbnail).not.toHaveBeenCalled();
  });

  it("refuses to start an upload it could not finish: no scope for cover and visibility", async () => {
    const store = fakeStore();
    const api = fakeApi({ grantedScopes: vi.fn(async () => ["https://www.googleapis.com/auth/youtube.upload"]) });
    await expect(publishQueueItem(deps(store, api), "q1")).rejects.toThrow("youtube_scope_missing");
    expect(api.insert).not.toHaveBeenCalled();
    expect(store.failUpload).toHaveBeenCalledWith("q1", "youtube_scope_missing");
  });

  it("refuses to start an upload whose cover file is missing", async () => {
    const store = fakeStore(queued({ thumbnail_path: null }));
    const api = fakeApi();
    await expect(publishQueueItem(deps(store, api), "q1")).rejects.toThrow("thumbnail_asset_missing");
    expect(api.insert).not.toHaveBeenCalled();
    expect(store.failUpload).toHaveBeenCalledWith("q1", "thumbnail_asset_missing");
  });

  it("counts a cover file lost after the upload as a cover failure", async () => {
    const store = fakeStore(null, { claimFinalize: vi.fn(async () => onYoutube({ thumbnail_path: null })) });
    const api = fakeApi();
    await expect(publishQueueItem(deps(store, api), "q1")).resolves.toMatchObject({ stage: "thumbnail_failed", error: "thumbnail_asset_missing" });
    expect(api.updateStatus).not.toHaveBeenCalled();
  });

  describe("visibility, always from decideUpload()", () => {
    it("leaves a private item private: no visibility call at all", async () => {
      const store = fakeStore(queued({ privacy: "private", public_authorized_at: null }));
      const api = fakeApi();
      await expect(publishQueueItem(deps(store, api), "q1")).resolves.toEqual({ stage: "published_with_cover", videoId: "yt-1", privacy: "private" });
      expect(api.updateStatus).not.toHaveBeenCalled();
      expect(store.completePublication).toHaveBeenCalledWith("q1", "private");
    });

    it("schedules a future publishAt instead of publishing early", async () => {
      const store = fakeStore(queued({ publish_at: "2026-11-08T12:00:00Z" }));
      const api = fakeApi();
      await publishQueueItem(deps(store, api), "q1");
      expect(vi.mocked(api.insert).mock.calls[0]?.[0].requestBody.status.publishAt).toBeUndefined();
      expect(api.updateStatus).toHaveBeenCalledWith("yt-1", expect.objectContaining({ privacyStatus: "private", publishAt: "2026-11-08T12:00:00Z" }));
      expect(store.completePublication).toHaveBeenCalledWith("q1", "public");
    });

    it("publishes at once when publishAt has already passed", async () => {
      const store = fakeStore(queued({ publish_at: "2026-11-08T06:00:00Z" }));
      const api = fakeApi();
      await publishQueueItem(deps(store, api), "q1");
      expect(api.updateStatus).toHaveBeenCalledWith("yt-1", expect.objectContaining({ privacyStatus: "public" }));
      expect(vi.mocked(api.updateStatus).mock.calls[0]?.[1].publishAt).toBeUndefined();
    });

    it("keeps the video private when the policy no longer allows public at finalize time", async () => {
      const store = fakeStore(null, { claimFinalize: vi.fn(async () => onYoutube()) });
      const api = fakeApi();
      await expect(publishQueueItem(deps(store, api, { config: safe }), "q1")).resolves.toEqual({ stage: "held_private", videoId: "yt-1", reason: "upload_refused:public_disabled" });
      expect(api.setThumbnail).toHaveBeenCalled();
      expect(api.updateStatus).not.toHaveBeenCalled();
      expect(store.completePublication).not.toHaveBeenCalled();
    });

    it("keeps the video private when the visibility update fails, to retry later", async () => {
      const store = fakeStore();
      const api = fakeApi({ updateStatus: vi.fn(async () => { throw Object.assign(new Error("x"), { code: 403, errors: [{ reason: "insufficientPermissions" }] }); }) });
      await expect(publishQueueItem(deps(store, api), "q1")).resolves.toEqual({ stage: "held_private", videoId: "yt-1", reason: "visibility_update_failed:403:insufficientPermissions" });
      expect(store.confirmThumbnail).toHaveBeenCalled();
      expect(store.completePublication).not.toHaveBeenCalled();
    });

    it("holds a video YouTube failed to process", async () => {
      const store = fakeStore();
      const api = fakeApi({ processingStatus: vi.fn(async () => "failed" as const) });
      await expect(publishQueueItem(deps(store, api), "q1")).resolves.toEqual({ stage: "held_private", videoId: "yt-1", reason: "youtube_processing_failed" });
      expect(api.setThumbnail).not.toHaveBeenCalled();
    });
  });

  it("keeps the single-step upload for items queued before covers existed", async () => {
    const store = fakeStore(queued({ thumbnail_asset_id: null, thumbnail_path: null }));
    const api = fakeApi();
    await expect(publishQueueItem(deps(store, api), "q1")).resolves.toEqual({ stage: "uploaded_without_cover", videoId: "yt-1", privacy: "public" });
    expect(vi.mocked(api.insert).mock.calls[0]?.[0].requestBody.status.privacyStatus).toBe("public");
    expect(store.registerUpload).toHaveBeenCalledWith("q1", "yt-1", "public");
    expect(store.recordVideo).not.toHaveBeenCalled();
    expect(api.grantedScopes).not.toHaveBeenCalled();
  });

  it("does nothing for an item that is neither queued nor waiting on YouTube", async () => {
    const store = fakeStore(null);
    const api = fakeApi();
    await expect(publishQueueItem(deps(store, api), "q1")).resolves.toEqual({ stage: "nothing" });
    expect(api.insert).not.toHaveBeenCalled();
  });
});
