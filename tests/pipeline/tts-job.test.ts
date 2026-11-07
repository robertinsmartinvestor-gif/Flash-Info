import { describe, expect, it, vi } from "vitest";
import type { TtsProvider } from "@/src/media/tts";
import { audioPath, type ProductionStore, runTtsJobs, type TtsJobDeps } from "@/src/pipeline/tts-job";

const CHARON = { provider: "google", voice: "it-IT-Chirp3-HD-Charon" };

function fakeStore(overrides: Partial<ProductionStore> = {}) {
  return {
    queuedJobIds: vi.fn(async () => ["job-1"]),
    claimJob: vi.fn(async (id: string) => ({ id, scriptVersionId: "version-1" })),
    loadVersion: vi.fn(async () => ({ scriptId: "script-1", narration: "ciao", approved: true })),
    loadVoiceSetting: vi.fn(async (): Promise<unknown> => CHARON),
    loadPreviewRetentionDays: vi.fn(async () => 14),
    monthlySpendUsd: vi.fn(async () => 0),
    saveFile: vi.fn(async () => undefined),
    recordAsset: vi.fn(async () => "asset-1"),
    recordUsage: vi.fn(async () => undefined),
    finishJob: vi.fn(async () => undefined),
    ...overrides,
  } satisfies ProductionStore;
}

function synthesizer(fail?: Error): TtsProvider & { synthesize: ReturnType<typeof vi.fn> } {
  return {
    name: "fake",
    synthesize: vi.fn(async (text: string) => {
      if (fail) throw fail;
      return { audio: new Uint8Array([1, 2]), mimeType: "audio/mpeg" as const, characters: text.length, wordTimings: null };
    }),
  };
}

const run = (store: ProductionStore, overrides: Partial<TtsJobDeps> = {}) =>
  runTtsJobs({ store, synthesizers: { google: synthesizer() }, monthlyBudgetUsd: 20, runnerId: "r", now: () => new Date("2026-11-07T00:00:00Z"), ...overrides });

describe("runTtsJobs", () => {
  it("reads the approved version with the chosen voice and records everything", async () => {
    const store = fakeStore();
    const google = synthesizer();
    await expect(run(store, { synthesizers: { google } })).resolves.toEqual([{ jobId: "job-1", status: "succeeded" }]);
    expect(google.synthesize).toHaveBeenCalledWith("ciao", "it-IT-Chirp3-HD-Charon");
    expect(store.saveFile).toHaveBeenCalledWith("audio/version-1/it-IT-Chirp3-HD-Charon.mp3", new Uint8Array([1, 2]), "audio/mpeg");
    expect(store.recordAsset).toHaveBeenCalledWith(expect.objectContaining({
      kind: "audio",
      sizeBytes: 2,
      expiresAt: "2026-11-21T00:00:00.000Z",
      rights: { provider: "google", voice: "it-IT-Chirp3-HD-Charon", aiGenerated: true },
    }));
    expect(store.recordUsage).toHaveBeenCalledWith(expect.objectContaining({ characters: 4, scriptId: "script-1" }));
    expect(store.finishJob).toHaveBeenCalledWith("job-1", expect.objectContaining({ status: "succeeded" }));
  });

  it.each([
    ["an unapproved version", { loadVersion: async () => ({ scriptId: "s", narration: "t", approved: false }) }, "script_not_approved"],
    ["a missing version", { loadVersion: async () => null }, "script_not_approved"],
    ["a voice outside the catalog", { loadVoiceSetting: async () => ({ provider: "google", voice: "x" }) }, "voice_invalid"],
    ["a spent budget", { monthlySpendUsd: async () => 20 }, "budget_exceeded"],
  ])("spends nothing on %s", async (_name, overrides, errorCode) => {
    const store = fakeStore(overrides);
    const google = synthesizer();
    await expect(run(store, { synthesizers: { google } })).resolves.toEqual([{ jobId: "job-1", status: "failed", errorCode }]);
    expect(google.synthesize).not.toHaveBeenCalled();
    expect(store.finishJob).toHaveBeenCalledWith("job-1", { status: "failed", errorCode });
  });

  it("fails when the chosen voice's provider has no credentials", async () => {
    const store = fakeStore({ loadVoiceSetting: async () => ({ provider: "azure", voice: "it-IT-Alessio:DragonHDLatestNeural" }) });
    await expect(run(store)).resolves.toEqual([{ jobId: "job-1", status: "failed", errorCode: "tts_no_credentials" }]);
  });

  it("keeps the usage when saving fails after the provider answered", async () => {
    const store = fakeStore({ saveFile: async () => { throw new Error("tts_storage_upload"); } });
    await expect(run(store)).resolves.toEqual([{ jobId: "job-1", status: "failed", errorCode: "tts_storage_upload" }]);
    expect(store.recordUsage).toHaveBeenCalledTimes(1);
  });

  it("does not let unexpected error text reach the log or the database", async () => {
    const store = fakeStore();
    const outcomes = await run(store, { synthesizers: { google: synthesizer(new Error("private_key=abc")) } });
    expect(outcomes).toEqual([{ jobId: "job-1", status: "failed", errorCode: "tts_failed" }]);
  });

  it("skips a job another runner took, and one failure does not stop the next", async () => {
    const store = fakeStore({
      queuedJobIds: async () => ["taken", "bad", "good"],
      claimJob: async (id) => (id === "taken" ? null : { id, scriptVersionId: id }),
      loadVersion: async (id) => ({ scriptId: "s", narration: "t", approved: id === "good" }),
    });
    const outcomes = await run(store);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(["skipped", "failed", "succeeded"]);
  });
});

describe("audioPath", () => {
  it("removes the colon of Azure HD voices", () => {
    const path = audioPath("v", { provider: "azure", voice: "it-IT-Alessio:DragonHDLatestNeural", label: "", verified: false });
    expect(path).toBe("audio/v/it-IT-Alessio-DragonHDLatestNeural.mp3");
    expect(path).toMatch(/^[\w/.-]+$/);
  });
});
