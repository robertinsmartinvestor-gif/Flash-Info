import { describe, expect, it } from "vitest";
import { loadPublicationConfig } from "@/src/core/publication-policy";
import { apiErrorCode, buildInsertRequest, finalVisibility, UploadRefusedError, type QueueItem } from "@/src/distribution/youtube";

const NOW = new Date("2026-11-08T07:00:00Z");

const safe = loadPublicationConfig({});
const live = loadPublicationConfig({ ALLOW_PUBLIC_PUBLICATION: "true", OGNIORA_ENV: "production", PUBLICATION_MODE: "assisted" });

const item = (overrides: Partial<QueueItem> = {}): QueueItem => ({
  id: "q", privacy: "private", publish_at: null, contains_synthetic_media: true, title: "T", description: "D", tags: ["a"],
  public_authorized_by: null, public_authorized_at: null, storage_path: "v.mp4", script_approved: true, ...overrides,
});
const authorized = { privacy: "public" as const, public_authorized_by: "u", public_authorized_at: "2026-11-05T10:00:00Z" };

describe("buildInsertRequest", () => {
  it("always states the privacy status, since YouTube defaults to public", () => {
    expect(buildInsertRequest(safe, item()).requestBody.status.privacyStatus).toBe("private");
    expect(buildInsertRequest(safe, item({ privacy: "unlisted" })).requestBody.status.privacyStatus).toBe("unlisted");
  });

  it("declares synthetic media and the audience", () => {
    expect(buildInsertRequest(safe, item()).requestBody.status).toMatchObject({ containsSyntheticMedia: true, selfDeclaredMadeForKids: false });
  });

  it("does not notify subscribers of test uploads", () => {
    expect(buildInsertRequest(safe, item()).notifySubscribers).toBe(false);
  });

  it("refuses unapproved content", () => {
    expect(() => buildInsertRequest(safe, item({ script_approved: false }))).toThrow(UploadRefusedError);
  });

  it("refuses public on the default config, even when authorized", () => {
    expect(() => buildInsertRequest(safe, item(authorized))).toThrow("public_disabled");
  });

  it("drops publishAt without public authorization, or YouTube would publish the video by itself", () => {
    const status = buildInsertRequest(safe, item({ publish_at: "2026-12-01T10:00:00Z" })).requestBody.status;
    expect(status.privacyStatus).toBe("private");
    expect(status.publishAt).toBeUndefined();
  });

  it("schedules authorized public videos as private plus publishAt", () => {
    const status = buildInsertRequest(live, item({ ...authorized, publish_at: "2026-12-01T10:00:00Z" }), NOW).requestBody.status;
    expect(status).toMatchObject({ privacyStatus: "private", publishAt: "2026-12-01T10:00:00Z" });
  });

  it("publishes at once only when authorized and enabled", () => {
    expect(buildInsertRequest(live, item(authorized)).requestBody.status.privacyStatus).toBe("public");
  });
});

describe("autopilot authorization", () => {
  it("accepts a public authorization with a time and no user", () => {
    const request = buildInsertRequest(live, item({ privacy: "public", public_authorized_by: null, public_authorized_at: "2026-11-08T10:00:00Z" }));
    expect(request.requestBody.status.privacyStatus).toBe("public");
  });

  it("still refuses public without any authorization", () => {
    expect(() => buildInsertRequest(live, item({ privacy: "public" }))).toThrow("public_not_authorized");
  });
});

describe("items with a cover", () => {
  const withCover = { thumbnail_asset_id: "t", thumbnail_path: "thumbnail/v/cover-v1.png" };

  it("go up with their final visibility at once, notifying subscribers when public", () => {
    const request = buildInsertRequest(live, item({ ...authorized, ...withCover }), NOW);
    expect(request.requestBody.status).toEqual({ privacyStatus: "public", selfDeclaredMadeForKids: false, containsSyntheticMedia: true });
    expect(request.notifySubscribers).toBe(true);
  });

  it("are still refused at insert time when the policy refuses them", () => {
    expect(() => buildInsertRequest(safe, item({ ...authorized, ...withCover }), NOW)).toThrow("public_disabled");
    expect(() => buildInsertRequest(live, item({ ...withCover, script_approved: false }), NOW)).toThrow("script_not_approved");
  });
});

describe("finalVisibility", () => {
  it("comes from decideUpload: public only when authorized and enabled", () => {
    expect(finalVisibility(live, item(authorized), NOW).privacyStatus).toBe("public");
    expect(finalVisibility(live, item(), NOW).privacyStatus).toBe("private");
    expect(() => finalVisibility(live, item({ privacy: "public" }), NOW)).toThrow("public_not_authorized");
  });

  it("never publishes before publishAt, and does not schedule in the past", () => {
    expect(finalVisibility(live, item({ ...authorized, publish_at: "2026-11-08T12:00:00Z" }), NOW)).toMatchObject({ privacyStatus: "private", publishAt: "2026-11-08T12:00:00Z" });
    expect(finalVisibility(live, item({ ...authorized, publish_at: "2026-11-08T06:00:00Z" }), NOW)).toEqual({ privacyStatus: "public", selfDeclaredMadeForKids: false, containsSyntheticMedia: true });
  });
});

describe("apiErrorCode", () => {
  it("keeps only the status and Google's reason, never the message", () => {
    expect(apiErrorCode("thumbnail_set_failed", Object.assign(new Error("token=secret"), { code: 403, errors: [{ reason: "forbidden" }] }))).toBe("thumbnail_set_failed:403:forbidden");
    expect(apiErrorCode("x", new Error("token=secret"))).toBe("x");
  });

  it("reads the reason where googleapis puts it", () => {
    const error = Object.assign(new Error("Request failed"), { status: 403, response: { data: { error: { errors: [{ reason: "forbidden", message: "secret" }] } } } });
    expect(apiErrorCode("thumbnail_set_failed", error)).toBe("thumbnail_set_failed:403:forbidden");
  });
});
