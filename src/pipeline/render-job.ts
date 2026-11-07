import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scriptDraftSchema } from "@/src/editorial/schema";
import { toSrt } from "@/src/media/captions";
import { buildRenderSpec, citedPublishers, type RenderSpec, validateRenderedVideo, type VideoEngine } from "@/src/media/render-spec";
import { type ClaimedJob, type JobOutcome, type JobQueue, runQueuedJobs } from "./job-runner";
import type { MediaAsset } from "./tts-job";

export interface VersionToRender {
  scriptId: string;
  content: unknown;
  evidence: unknown;
  /** True only when this exact version is the approved one. */
  approved: boolean;
}

export interface RenderStore extends JobQueue {
  loadVersionToRender(versionId: string): Promise<VersionToRender | null>;
  /** The newest audio of the version that has not been deleted. */
  loadAudioAsset(versionId: string): Promise<{ storagePath: string; rights: unknown } | null>;
  loadPreviewRetentionDays(): Promise<number>;
  downloadFile(path: string): Promise<Uint8Array>;
  saveFile(path: string, bytes: Uint8Array, mimeType: string): Promise<void>;
  recordAsset(asset: MediaAsset): Promise<string>;
}

export interface RenderJobDeps {
  store: RenderStore;
  engine: VideoEngine;
  runnerId: string;
  now?: () => Date;
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function specFor(version: VersionToRender, audioPath: string, durationSeconds: number): RenderSpec {
  const draft = scriptDraftSchema.safeParse(version.content);
  if (!draft.success) throw new Error("render_script_invalid");
  try {
    return buildRenderSpec(draft.data, citedPublishers(draft.data, version.evidence), audioPath, durationSeconds);
  } catch {
    throw new Error("render_spec_invalid");
  }
}

async function produce(deps: RenderJobDeps, job: ClaimedJob): Promise<Record<string, unknown>> {
  const { store, engine } = deps;
  const version = await store.loadVersionToRender(job.scriptVersionId);
  if (!version?.approved) throw new Error("script_not_approved");
  const audio = await store.loadAudioAsset(job.scriptVersionId);
  if (!audio) throw new Error("render_audio_missing");

  const dir = await mkdtemp(join(tmpdir(), "ogniora-render-"));
  try {
    const audioFile = join(dir, "audio.mp3");
    const videoFile = join(dir, "video.mp4");
    await writeFile(audioFile, await store.downloadFile(audio.storagePath));

    const durationSeconds = await engine.probeDuration(audioFile);
    const spec = specFor(version, audio.storagePath, durationSeconds);
    const rendered = await engine.render(spec, audioFile, videoFile);
    const [problem] = validateRenderedVideo(rendered, spec);
    if (problem) throw new Error(`render_${problem}`);

    const days = await store.loadPreviewRetentionDays();
    const now = (deps.now ?? (() => new Date()))();
    const shared = {
      jobId: job.id,
      scriptVersionId: job.scriptVersionId,
      expiresAt: new Date(now.getTime() + days * 86_400_000).toISOString(),
    };

    const video = await readFile(videoFile);
    const videoPath = `video/${job.scriptVersionId}/${spec.template}.mp4`;
    await store.saveFile(videoPath, video, "video/mp4");
    const videoAssetId = await store.recordAsset({
      ...shared,
      kind: "video",
      mimeType: "video/mp4",
      storagePath: videoPath,
      sizeBytes: video.byteLength,
      sha256: sha256(video),
      durationSeconds: rendered.durationSeconds,
      rights: { template: spec.template, engine: engine.name, imagery: "none", voice: audio.rights },
    });

    const subtitles = new TextEncoder().encode(toSrt(spec.captions));
    const subtitlesPath = `subtitles/${job.scriptVersionId}/it.srt`;
    await store.saveFile(subtitlesPath, subtitles, "application/x-subrip");
    await store.recordAsset({
      ...shared,
      kind: "subtitles",
      mimeType: "application/x-subrip",
      storagePath: subtitlesPath,
      sizeBytes: subtitles.byteLength,
      sha256: sha256(subtitles),
      rights: { derivedFrom: "approved_script" },
    });
    return { videoAssetId, durationSeconds: rendered.durationSeconds, sizeBytes: video.byteLength };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function runRenderJobs(deps: RenderJobDeps): Promise<JobOutcome[]> {
  return runQueuedJobs(
    deps.store,
    { kind: "render", runnerId: deps.runnerId, knownError: /^(render_|script_)[a-z0-9_]+$/, fallbackError: "render_failed" },
    (job) => produce(deps, job),
  );
}
