import { describe, expect, it, vi } from "vitest";
import { runAdvanceStep, runEditorialStep, uploadIds, type AutopilotStore, type VersionInProduction } from "@/src/pipeline/autopilot";

const version = (overrides: Partial<VersionInProduction> = {}): VersionInProduction => ({
  versionId: "v1", hasTtsJob: false, hasAudio: false, hasRenderJob: false, hasVideo: false, queued: false, ...overrides,
});

function store(overrides: Partial<AutopilotStore> = {}): AutopilotStore {
  return {
    enabled: async () => true,
    selectCandidate: async () => "c1",
    approveScript: vi.fn(async () => true),
    freshApprovedVersions: async () => [],
    enqueueJob: vi.fn(async () => undefined),
    queuePublic: vi.fn(async () => undefined),
    pendingPublicUploads: async () => [],
    ...overrides,
  };
}

describe("runEditorialStep", () => {
  it("writes the selected story and asks the database to approve it", async () => {
    const s = store();
    const report = await runEditorialStep(s, async () => ({ scriptId: "s1", verdict: "needs_review" }));
    expect(report).toEqual({ action: "composed", candidateId: "c1", scriptId: "s1", verdict: "needs_review", approved: true });
    expect(s.approveScript).toHaveBeenCalledWith("s1");
  });

  it("does not ask to approve a blocked script", async () => {
    const s = store();
    const report = await runEditorialStep(s, async () => ({ scriptId: "s1", verdict: "blocked" }));
    expect(report).toMatchObject({ approved: false });
    expect(s.approveScript).not.toHaveBeenCalled();
  });

  it("spends nothing when switched off or with no candidate", async () => {
    const compose = vi.fn();
    expect(await runEditorialStep(store({ enabled: async () => false }), compose)).toEqual({ action: "disabled" });
    expect(await runEditorialStep(store({ selectCandidate: async () => null }), compose)).toEqual({ action: "no_candidate" });
    expect(compose).not.toHaveBeenCalled();
  });
});

describe("runAdvanceStep", () => {
  it("moves each version exactly one step", async () => {
    const s = store({
      freshApprovedVersions: async () => [
        version({ versionId: "new" }),
        version({ versionId: "audio-running", hasTtsJob: true }),
        version({ versionId: "audio-done", hasTtsJob: true, hasAudio: true }),
        version({ versionId: "video-running", hasTtsJob: true, hasAudio: true, hasRenderJob: true }),
        version({ versionId: "video-done", hasTtsJob: true, hasAudio: true, hasRenderJob: true, hasVideo: true }),
        version({ versionId: "queued", hasVideo: true, queued: true }),
      ],
    });
    expect(await runAdvanceStep(s)).toEqual({ tts: 1, render: 1, published: 1, errors: [] });
    expect(s.enqueueJob).toHaveBeenCalledWith("new", "tts");
    expect(s.enqueueJob).toHaveBeenCalledWith("audio-done", "render");
    expect(s.queuePublic).toHaveBeenCalledWith("video-done");
  });

  it("keeps going after one failure and reports only the error class", async () => {
    const s = store({
      freshApprovedVersions: async () => [version({ versionId: "a" }), version({ versionId: "b" })],
      enqueueJob: vi.fn(async (id: string) => {
        if (id === "a") throw new Error("autopilot_enqueue_tts:P0001 <script>");
      }),
    });
    expect(await runAdvanceStep(s)).toEqual({ tts: 1, render: 0, published: 0, errors: ["autopilot_enqueue_tts:P0001 script"] });
  });
});

describe("uploadIds", () => {
  it("lets only UUIDs reach the upload loop", async () => {
    const id = "0b9a3c1e-5d2f-4a6b-8c7d-9e0f1a2b3c4d";
    expect(await uploadIds(store({ pendingPublicUploads: async () => [id, "$(rm -rf /)", ""] }))).toEqual([id]);
    expect(await uploadIds(store({ enabled: async () => false, pendingPublicUploads: async () => [id] }))).toEqual([]);
  });
});
