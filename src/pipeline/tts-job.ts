import { createHash } from "node:crypto";
import { LIST_PRICE_PER_MILLION } from "@/src/media/listening-test";
import type { TtsProvider } from "@/src/media/tts";
import { findVoice, type VoiceOption, type VoiceProvider } from "@/src/media/voices";
import { type ClaimedJob, type JobOutcome, type JobQueue, runQueuedJobs } from "./job-runner";

export interface VersionToRead {
  scriptId: string;
  narration: string;
  /** True only when this exact version is the approved one. */
  approved: boolean;
}

export interface MediaAsset {
  jobId: string;
  scriptVersionId: string;
  kind: "audio" | "video" | "subtitles";
  mimeType: string;
  storagePath: string;
  sizeBytes: number;
  sha256: string;
  durationSeconds?: number;
  rights: Record<string, unknown>;
  expiresAt: string;
}

export interface ProductionStore extends JobQueue {
  loadVersion(versionId: string): Promise<VersionToRead | null>;
  loadVoiceSetting(): Promise<unknown>;
  loadPreviewRetentionDays(): Promise<number>;
  monthlySpendUsd(): Promise<number>;
  saveFile(path: string, bytes: Uint8Array, mimeType: string): Promise<void>;
  recordAsset(asset: MediaAsset): Promise<string>;
  recordUsage(usage: { provider: VoiceProvider; voice: string; characters: number; costUsd: number; scriptId: string }): Promise<void>;
}

export interface TtsJobDeps {
  store: ProductionStore;
  synthesizers: Partial<Record<VoiceProvider, TtsProvider>>;
  monthlyBudgetUsd: number;
  runnerId: string;
  now?: () => Date;
}

/** Storage keys and render specs accept no colon, and Azure HD voice names have one. */
export function audioPath(versionId: string, voice: VoiceOption): string {
  return `audio/${versionId}/${voice.voice.replace(/[^\w.-]/g, "-")}.mp3`;
}

export function ttsCostUsd(provider: VoiceProvider, characters: number): number {
  return (characters * LIST_PRICE_PER_MILLION[provider]) / 1_000_000;
}

async function produce(deps: TtsJobDeps, job: ClaimedJob): Promise<Record<string, unknown>> {
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
  await store.saveFile(storagePath, result.audio, "audio/mpeg");
  const days = await store.loadPreviewRetentionDays();
  const now = (deps.now ?? (() => new Date()))();
  const assetId = await store.recordAsset({
    jobId: job.id,
    scriptVersionId: job.scriptVersionId,
    kind: "audio",
    mimeType: "audio/mpeg",
    storagePath,
    sizeBytes: result.audio.byteLength,
    sha256: createHash("sha256").update(result.audio).digest("hex"),
    rights: { provider: voice.provider, voice: voice.voice, aiGenerated: true },
    expiresAt: new Date(now.getTime() + days * 86_400_000).toISOString(),
  });
  return { assetId, provider: voice.provider, voice: voice.voice, characters: result.characters };
}

export function runTtsJobs(deps: TtsJobDeps): Promise<JobOutcome[]> {
  return runQueuedJobs(
    deps.store,
    { kind: "tts", runnerId: deps.runnerId, knownError: /^(tts_|budget_|script_|voice_)[a-z0-9_]+$/, fallbackError: "tts_failed" },
    (job) => produce(deps, job),
  );
}
