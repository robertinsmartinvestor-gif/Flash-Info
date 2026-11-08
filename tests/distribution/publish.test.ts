import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadPublicationConfig, type PrivacyStatus } from "@/src/core/publication-policy";
import { publishQueueItem, type PublicationStore, type PublishDeps } from "@/src/distribution/publish";
import type { FinalizeItem, QueueItem, YoutubeApi } from "@/src/distribution/youtube";

const NOW = new Date("2026-11-08T07:05:00Z");
const live = loadPublicationConfig({ ALLOW_PUBLIC_PUBLICATION: "true", OGNIORA_ENV: "production", PUBLICATION_MODE: "automatic" });
const safe = loadPublicationConfig({});

const queued = (overrides: Partial<QueueItem> = {}): QueueItem => ({
  id: "q1", privacy: "public", publish_at: null, contains_synthetic_media: true, title: "T", description: "D", tags: [],
  public_authorized_by: null, public_authorized_at: "2026-11-08T07:00:00Z", storage_path: "video/v1/flash-v1.mp4", script_approved: true,
  thumbnail_asset_id: "thumb-1", thumbnail_path: "thumbnail/v1/cover-v1.png", ...overrides,
});
const onYoutube = (overrides: Partial<FinalizeItem> = {}): FinalizeItem => ({
  ...queued(), youtube_video_id: "yt-1", youtube_privacy: "public", thumbnail_status: "pending", thumbnail_attempts: 0, ...overrides,
});

/** A store that keeps the real state machine: begin_upload refuses an item once its video id is recorded. */
function fakeStore(item: QueueItem | null = queued(), overrides: Partial<PublicationStore> = {}) {
  let video: { id: string; privacy: PrivacyStatus } | null = null;
  return {
    beginUpload: vi.fn(async () => (video || !item ? null : item)),
    failUpload: vi.fn(async () => undefined),
    registerUpload: vi.fn(async () => undefined),
    recordVideo: vi.fn(async (_queueId: string, id: string, privacy: PrivacyStatus) => {
      video = { id, privacy };
    }),
    claimFinalize: vi.fn(async (): Promise<FinalizeItem | null> =>
      video && item ? { ...item, youtube_video_id: video.id, youtube_privacy: video.privacy, thumbnail_status: "pending", thumbnail_attempts: 0 } : null),
    releaseFinalize: vi.fn(async () => undefined),
    failThumbnail: vi.fn(async () => undefined),
    confirmThumbnail: vi.fn(async () => undefined),
    download: vi.fn(async () => new Uint8Array([1, 2, 3])),
    ...overrides,
  } satisfies PublicationStore;
}

function fakeApi(overrides: Partial<YoutubeApi> = {}): YoutubeApi {
  return {
    insert: vi.fn(async () => "yt-1"),
    processingStatus: vi.fn(async () => "succeeded" as const),
    setThumbnail: vi.fn(async () => true),
    ...overrides,
  };
}

const deps = (store: PublicationStore, api: YoutubeApi, overrides: Partial<PublishDeps> = {}): PublishDeps => ({
  store, api, config: live, workDir: mkdtempSync(join(tmpdir(), "publish-test-")), now: () => NOW, sleep: vi.fn(async () => undefined), ...overrides,
});
const order = (fn: unknown) => vi.mocked(fn as () => unknown).mock.invocationCallOrder[0]!;
const insertStatus = (api: YoutubeApi) => vi.mocked(api.insert).mock.calls[0]?.[0].requestBody.status;

describe("publishQueueItem", () => {
  it("publishes at once with the final visibility, then sets the cover on the published video", async () => {
    const store = fakeStore();
    const api = fakeApi();
    await expect(publishQueueItem(deps(store, api), "q1")).resolves.toEqual({ stage: "cover_set", videoId: "yt-1", privacy: "public" });

    const request = vi.mocked(api.insert).mock.calls[0]?.[0];
    expect(request?.requestBody.status).toEqual({ privacyStatus: "public", selfDeclaredMadeForKids: false, containsSyntheticMedia: true });
    expect(request?.notifySubscribers).toBe(true);
    expect(store.recordVideo).toHaveBeenCalledWith("q1", "yt-1", "public");
    expect(store.download).toHaveBeenCalledWith("thumbnail/v1/cover-v1.png");
    expect(api.setThumbnail).toHaveBeenCalledWith("yt-1", expect.stringMatching(/q1\.png$/));
    expect(store.confirmThumbnail).toHaveBeenCalledWith("q1");

    expect(order(api.insert)).toBeLessThan(order(store.recordVideo));
    expect(order(store.recordVideo)).toBeLessThan(order(api.processingStatus));
    expect(order(api.processingStatus)).toBeLessThan(order(api.setThumbnail));
    expect(order(api.setThumbnail)).toBeLessThan(order(store.confirmThumbnail));
  });

  it("waits for YouTube's processing and picks the cover up at the next run, without counting a failure", async () => {
    const store = fakeStore();
    const api = fakeApi({ processingStatus: vi.fn(async () => "processing" as const) });
    const d = deps(store, api, { processingChecks: 3 });
    await expect(publishQueueItem(d, "q1")).resolves.toEqual({ stage: "waiting_processing", videoId: "yt-1", privacy: "public" });
    expect(api.processingStatus).toHaveBeenCalledTimes(3);
    expect(d.sleep).toHaveBeenCalledTimes(2);
    expect(store.releaseFinalize).toHaveBeenCalledWith("q1", "youtube_processing");
    expect(api.setThumbnail).not.toHaveBeenCalled();
    expect(store.failThumbnail).not.toHaveBeenCalled();
  });

  it("tries the cover a few spaced times when the token cannot read the processing status", async () => {
    const store = fakeStore();
    const setThumbnail = vi.fn().mockRejectedValueOnce(Object.assign(new Error("x"), { code: 400 })).mockResolvedValue(true);
    const api = fakeApi({ processingStatus: vi.fn(async () => { throw Object.assign(new Error("x"), { code: 403 }); }), setThumbnail });
    const d = deps(store, api);
    await expect(publishQueueItem(d, "q1")).resolves.toMatchObject({ stage: "cover_set" });
    expect(setThumbnail).toHaveBeenCalledTimes(2);
    expect(d.sleep).toHaveBeenCalledWith(30_000);
    expect(store.failThumbnail).not.toHaveBeenCalled();
  });

  it("records a refused cover apart from the upload, and the video keeps its visibility", async () => {
    const error = Object.assign(new Error("The authenticated user doesn't have permissions"), { code: 403, errors: [{ reason: "forbidden" }] });
    const store = fakeStore();
    const api = fakeApi({ setThumbnail: vi.fn(async () => { throw error; }) });
    await expect(publishQueueItem(deps(store, api), "q1")).resolves.toEqual({
      stage: "thumbnail_failed", videoId: "yt-1", privacy: "public", error: "thumbnail_set_failed:403:forbidden",
    });
    expect(store.failThumbnail).toHaveBeenCalledWith("q1", "thumbnail_set_failed:403:forbidden");
    expect(store.failUpload).not.toHaveBeenCalled();
    expect(store.confirmThumbnail).not.toHaveBeenCalled();
  });

  it("does not take an answer without the new thumbnail as a confirmation", async () => {
    const store = fakeStore();
    const api = fakeApi({ setThumbnail: vi.fn(async () => false) });
    await expect(publishQueueItem(deps(store, api), "q1")).resolves.toMatchObject({ stage: "thumbnail_failed", error: "thumbnail_not_confirmed" });
    expect(store.confirmThumbnail).not.toHaveBeenCalled();
  });

  it("retries from the YouTube id already recorded, never inserting the video twice", async () => {
    const store = fakeStore();
    const failing = vi.fn().mockRejectedValueOnce(Object.assign(new Error("x"), { code: 429, errors: [{ reason: "uploadRateLimitExceeded" }] })).mockResolvedValue(true);
    const api = fakeApi({ setThumbnail: failing });
    await expect(publishQueueItem(deps(store, api), "q1")).resolves.toMatchObject({ stage: "thumbnail_failed", error: "thumbnail_set_failed:429:uploadRateLimitExceeded" });
    await expect(publishQueueItem(deps(store, api), "q1")).resolves.toEqual({ stage: "cover_set", videoId: "yt-1", privacy: "public" });
    expect(api.insert).toHaveBeenCalledTimes(1);
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it("keeps the item in 'uploading' when the id cannot be recorded, so no retry uploads it again", async () => {
    const store = fakeStore(queued(), { recordVideo: vi.fn(async () => { throw new Error("record_youtube_video:P0001"); }) });
    const api = fakeApi();
    await expect(publishQueueItem(deps(store, api), "q1")).rejects.toThrow("upload_not_registered:yt-1");
    expect(store.failUpload).not.toHaveBeenCalled();
    expect(api.setThumbnail).not.toHaveBeenCalled();
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
    expect(api.setThumbnail).not.toHaveBeenCalled();
  });

  it("does not set a cover on a video YouTube failed to process", async () => {
    const store = fakeStore();
    const api = fakeApi({ processingStatus: vi.fn(async () => "failed" as const) });
    await expect(publishQueueItem(deps(store, api), "q1")).resolves.toEqual({ stage: "processing_failed", videoId: "yt-1", reason: "youtube_processing_failed" });
    expect(api.setThumbnail).not.toHaveBeenCalled();
  });

  describe("visibility, only from decideUpload() and only at insert time", () => {
    it("uploads a private item as private and notifies nobody", async () => {
      const store = fakeStore(queued({ privacy: "private", public_authorized_at: null }));
      const api = fakeApi();
      await publishQueueItem(deps(store, api), "q1");
      expect(insertStatus(api)?.privacyStatus).toBe("private");
      expect(vi.mocked(api.insert).mock.calls[0]?.[0].notifySubscribers).toBe(false);
      expect(store.recordVideo).toHaveBeenCalledWith("q1", "yt-1", "private");
    });

    it("schedules a future publishAt instead of publishing early", async () => {
      const store = fakeStore(queued({ publish_at: "2026-11-08T12:00:00Z" }));
      const api = fakeApi();
      await publishQueueItem(deps(store, api), "q1");
      expect(insertStatus(api)).toMatchObject({ privacyStatus: "private", publishAt: "2026-11-08T12:00:00Z" });
      expect(store.recordVideo).toHaveBeenCalledWith("q1", "yt-1", "public");
    });

    it("publishes at once when publishAt has already passed", async () => {
      const store = fakeStore(queued({ publish_at: "2026-11-08T06:00:00Z" }));
      const api = fakeApi();
      await publishQueueItem(deps(store, api), "q1");
      expect(insertStatus(api)?.privacyStatus).toBe("public");
      expect(insertStatus(api)?.publishAt).toBeUndefined();
    });

    it("refuses public before any upload when the policy does not allow it", async () => {
      const store = fakeStore();
      const api = fakeApi();
      await expect(publishQueueItem(deps(store, api, { config: safe }), "q1")).rejects.toThrow("upload_refused:public_disabled");
      expect(api.insert).not.toHaveBeenCalled();
      expect(store.failUpload).toHaveBeenCalledWith("q1", "upload_refused:public_disabled");
    });

    it("never changes visibility when setting the cover", () => {
      expect(Object.keys(fakeApi())).toEqual(["insert", "processingStatus", "setThumbnail"]);
    });
  });

  it("keeps the single-step upload for items queued before covers existed", async () => {
    const store = fakeStore(queued({ thumbnail_asset_id: null, thumbnail_path: null }));
    const api = fakeApi();
    await expect(publishQueueItem(deps(store, api), "q1")).resolves.toEqual({ stage: "uploaded_without_cover", videoId: "yt-1", privacy: "public" });
    expect(store.registerUpload).toHaveBeenCalledWith("q1", "yt-1", "public");
    expect(store.recordVideo).not.toHaveBeenCalled();
    expect(api.setThumbnail).not.toHaveBeenCalled();
  });

  it("does nothing for an item that is neither queued nor waiting for its cover", async () => {
    const store = fakeStore(null);
    const api = fakeApi();
    await expect(publishQueueItem(deps(store, api), "q1")).resolves.toEqual({ stage: "nothing" });
    expect(api.insert).not.toHaveBeenCalled();
  });
});
