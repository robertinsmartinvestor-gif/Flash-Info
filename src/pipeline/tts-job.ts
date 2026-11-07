import { createHash } from "node:crypto";
import { LIST_PRICE_PER_MILLION } from "@/src/media/listening-test";
import type { TtsProvider } from "@/src/media/tts";
import { findVoice, type VoiceOption, type VoiceProvider } from "@/src/media/voices";

export interface ClaimedTtsJob {
  id: string;
  scriptVersionId: string;
}

export interface VersionToRead {
  scriptId: string;
  narration: string;
  /** True only when this exact version is the approved one. */
  approved: boolean;
}

export interface AudioAsset {
  jobId: string;
  scriptVersionId: string;
  storagePath: string;
  sizeBytes: number;
  sha256: string;
  rights: { provider: VoiceProvider; voice: string; aiGenerated: true };
  expiresAt: string;
}

export interface ProductionStore {
  queuedTtsJobIds(limit: number): Promise<string[]>;
  /** Null when another runner has it or it is no longer queued. */
  claimJob(jobId: string, runnerId: string): Promise<ClaimedTtsJob | null>;
  loadVersion(versionId: string): Promise<VersionToRead | null>;
  loadVoiceSetting(): Promise<unknown>;
  loadPreviewRetentionDays(): Promise<number>;
  monthlySpendUsd(): Promise<number>;
  saveAudio(path: string, audio: Uint8Array): Promise<void>;
  recordAsset(asset: AudioAsset): Promise<string>;
  recordUsage(usage: { provider: VoiceProvider; voice: string; characters: number; costUsd: number; scriptId: string }): Promise<void>;
  finishJob(jobId: string, outcome: { status: "succeeded"; result: Record<string, unknown> } | { status: "failed"; errorCode: string }): Promise<void>;
}

export interface TtsJobDeps {
  store: ProductionStore;
  synthesizers: Partial<Record<VoiceProvider, TtsProvider>>;
  monthlyBudgetUsd: number;
  runnerId: string;
  now?: () => Date;
}

export type TtsJobOutcome = { jobId: string; status: "skipped" | "succeeded" } | { jobId: string; status: "failed"; errorCode: string };

const MAX_JOBS_PER_RUN = 3;
const KNOWN_ERROR = /^(tts_|budget_|script_|voice_)[a-z0-9_]+$/;

/** Storage keys and render specs accept no colon, and Azure HD voice names have one. */
export function audioPath(versionId: string, voice: VoiceOption): string {
  return `audio/${versionId}/${voice.voice.replace(/[^\w.-]/g, "-")}.mp3`;
}

export function ttsCostUsd(provider: VoiceProvider, characters: number): number {
  return (characters * LIST_PRICE_PER_MILLION[provider]) / 1_000_000;
}

async function produce(deps: TtsJobDeps, job: ClaimedTtsJob): Promise<Record<string, unknown>> {
  const { store, synthesizers, monthlyBudgetUsd } = deps;
  const version = await store.loadVersion(job.scriptVersionId);
  if (!version?.approved) throw new Error("script_not_approved");

  const voice = findVoice(await store.loadVoiceSetting());
  if (!voice) throw new Error("voice_invalid");
  const synthesizer = synthesizers[voice.provider];
  if (!synthesizer) throw new Error("tts_no_credentials");

  const costUsd = ttsCostUsd(voice.provider, version.narration.length);
  if ((await store.monthlySpendUsd()) + costUsd > monthlyBudgetUsd) throw new Error("budget_exceeded");

  const result = await synthesizer.synthesize(version.narration, voice.voice);
  // Spent as soon as the provider answered, so a later failure cannot hide it.
  await store.recordUsage({ provider: voice.provider, voice: voice.voice, characters: result.characters, costUsd, scriptId: version.scriptId });

  const storagePath = audioPath(job.scriptVersionId, voice);
  await store.saveAudio(storagePath, result.audio);
  const days = await store.loadPreviewRetentionDays();
  const now = (deps.now ?? (() => new Date()))();
  const assetId = await store.recordAsset({
    jobId: job.id,
    scriptVersionId: job.scriptVersionId,
    storagePath,
    sizeBytes: result.audio.byteLength,
    sha256: createHash("sha256").update(result.audio).digest("hex"),
    rights: { provider: voice.provider, voice: voice.voice, aiGenerated: true },
    expiresAt: new Date(now.getTime() + days * 86_400_000).toISOString(),
  });
  return { assetId, provider: voice.provider, voice: voice.voice, characters: result.characters };
}

/** Takes the queued TTS jobs. One failing does not stop the next, and each ends with a recorded state. */
export async function runTtsJobs(deps: TtsJobDeps): Promise<TtsJobOutcome[]> {
  const outcomes: TtsJobOutcome[] = [];
  for (const jobId of await deps.store.queuedTtsJobIds(MAX_JOBS_PER_RUN)) {
    const job = await deps.store.claimJob(jobId, deps.runnerId);
    if (!job) {
      outcomes.push({ jobId, status: "skipped" });
      continue;
    }
    try {
      const result = await produce(deps, job);
      await deps.store.finishJob(job.id, { status: "succeeded", result });
      outcomes.push({ jobId, status: "succeeded" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      // The code lands in a public log and in the database: unexpected text never does.
      const errorCode = KNOWN_ERROR.test(message) ? message : "tts_failed";
      await deps.store.finishJob(job.id, { status: "failed", errorCode });
      outcomes.push({ jobId, status: "failed", errorCode });
    }
  }
  return outcomes;
}
