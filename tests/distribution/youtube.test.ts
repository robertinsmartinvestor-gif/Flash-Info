import { describe, expect, it } from "vitest";
import { loadPublicationConfig } from "@/src/core/publication-policy";
import { buildInsertRequest, UploadRefusedError, type QueueItem } from "@/src/distribution/youtube";

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
    const status = buildInsertRequest(live, item({ ...authorized, publish_at: "2026-12-01T10:00:00Z" })).requestBody.status;
    expect(status).toMatchObject({ privacyStatus: "private", publishAt: "2026-12-01T10:00:00Z" });
  });

  it("publishes at once only when authorized and enabled", () => {
    expect(buildInsertRequest(live, item(authorized)).requestBody.status.privacyStatus).toBe("public");
  });
});
