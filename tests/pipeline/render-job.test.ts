import { writeFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { citedPublishers, type VideoEngine } from "@/src/media/render-spec";
import { type RenderJobDeps, type RenderStore, runRenderJobs } from "@/src/pipeline/render-job";
import { validDraft } from "../helpers/fixtures";

const EVIDENCE = [{ evidenceId: "E1", publisher: "ANSA" }, { evidenceId: "E9", publisher: "Mai citata" }];

function fakeStore(overrides: Partial<RenderStore> = {}) {
  return {
    queuedJobIds: vi.fn(async () => ["job-1"]),
    claimJob: vi.fn(async (id: string) => ({ id, scriptVersionId: "version-1" })),
    finishJob: vi.fn(async () => undefined),
    loadVersionToRender: vi.fn(async () => ({ scriptId: "s", content: validDraft() as unknown, evidence: EVIDENCE as unknown, approved: true })),
    loadAudioAsset: vi.fn(async (): Promise<{ storagePath: string; rights: unknown } | null> => ({ storagePath: "audio/version-1/x.mp3", rights: { aiGenerated: true } })),
    loadPreviewRetentionDays: vi.fn(async () => 14),
    downloadFile: vi.fn(async () => new Uint8Array([1])),
    saveFile: vi.fn(async () => undefined),
    recordAsset: vi.fn(async () => "asset-1"),
    ...overrides,
  } satisfies RenderStore;
}

function fakeEngine(overrides: Partial<VideoEngine> = {}): VideoEngine {
  return {
    name: "fake",
    probeDuration: vi.fn(async () => 45),
    render: vi.fn(async (_spec, _audio, outputPath) => {
      await writeFile(outputPath, new Uint8Array([1, 2, 3]));
      return { path: outputPath, durationSeconds: 45, width: 1080, height: 1920, sizeBytes: 3 };
    }),
    ...overrides,
  };
}

const run = (store: RenderStore, engine = fakeEngine(), overrides: Partial<RenderJobDeps> = {}) =>
  runRenderJobs({ store, engine, runnerId: "r", now: () => new Date("2026-11-07T00:00:00Z"), ...overrides });

describe("runRenderJobs", () => {
  it("renders the approved version over its audio and stores video and subtitles", async () => {
    const store = fakeStore();
    const engine = fakeEngine();
    await expect(run(store, engine)).resolves.toEqual([{ jobId: "job-1", status: "succeeded" }]);

    expect(store.queuedJobIds).toHaveBeenCalledWith("render", 3);
    const spec = vi.mocked(engine.render).mock.calls[0]?.[0];
    expect(spec).toMatchObject({ durationSeconds: 45, audioAsset: "audio/version-1/x.mp3", sources: ["ANSA"] });
    expect(store.saveFile).toHaveBeenCalledWith("video/version-1/flash-v1.mp4", expect.anything(), "video/mp4");
    expect(store.saveFile).toHaveBeenCalledWith("subtitles/version-1/it.srt", expect.anything(), "application/x-subrip");
    expect(store.recordAsset).toHaveBeenCalledWith(expect.objectContaining({
      kind: "video",
      durationSeconds: 45,
      expiresAt: "2026-11-21T00:00:00.000Z",
      rights: { template: "flash-v1", engine: "fake", imagery: "none", voice: { aiGenerated: true } },
    }));
    expect(store.recordAsset).toHaveBeenCalledWith(expect.objectContaining({ kind: "subtitles" }));
  });

  it.each([
    ["an unapproved version", { loadVersionToRender: async () => ({ scriptId: "s", content: {}, evidence: [], approved: false }) }, "script_not_approved"],
    ["a missing version", { loadVersionToRender: async () => null }, "script_not_approved"],
    ["a version without audio", { loadAudioAsset: async () => null }, "render_audio_missing"],
    ["an unreadable script", { loadVersionToRender: async () => ({ scriptId: "s", content: { title: 1 }, evidence: [], approved: true }) }, "render_script_invalid"],
  ])("renders nothing for %s", async (_name, overrides, errorCode) => {
    const store = fakeStore(overrides);
    const engine = fakeEngine();
    await expect(run(store, engine)).resolves.toEqual([{ jobId: "job-1", status: "failed", errorCode }]);
    expect(engine.render).not.toHaveBeenCalled();
    expect(store.saveFile).not.toHaveBeenCalled();
  });

  it("does not hand a title with markup to the engine", async () => {
    const draft = validDraft();
    draft.title = '<img src=x onerror="fetch(1)">';
    const engine = fakeEngine();
    const store = fakeStore({ loadVersionToRender: async () => ({ scriptId: "s", content: draft, evidence: EVIDENCE, approved: true }) });
    await expect(run(store, engine)).resolves.toEqual([{ jobId: "job-1", status: "failed", errorCode: "render_spec_invalid" }]);
    expect(engine.render).not.toHaveBeenCalled();
  });

  it("stores nothing when the rendered file fails validation", async () => {
    const store = fakeStore();
    const engine = fakeEngine({ render: async (_spec, _audio, path) => ({ path, durationSeconds: 45, width: 1920, height: 1080, sizeBytes: 3 }) });
    await expect(run(store, engine)).resolves.toEqual([{ jobId: "job-1", status: "failed", errorCode: "render_wrong_resolution" }]);
    expect(store.saveFile).not.toHaveBeenCalled();
  });

  it("does not let unexpected error text reach the log or the database", async () => {
    const store = fakeStore({ downloadFile: async () => { throw new Error("service_role=abc"); } });
    await expect(run(store)).resolves.toEqual([{ jobId: "job-1", status: "failed", errorCode: "render_failed" }]);
  });
});

describe("citedPublishers", () => {
  const draft = validDraft();

  it("lists only sources the sentences cite, once each", () => {
    expect(citedPublishers(draft, [...EVIDENCE, { evidenceId: "E1", publisher: "ANSA" }])).toEqual(["ANSA"]);
  });

  it("ignores evidence in an unexpected shape", () => {
    expect(citedPublishers(draft, "x")).toEqual([]);
    expect(citedPublishers(draft, [{ evidenceId: 1 }])).toEqual([]);
  });
});
