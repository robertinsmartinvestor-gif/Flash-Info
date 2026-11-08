import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ScriptDraft, storedDraftSchema } from "@/src/editorial/schema";
import { buildCoverSpec, COVER_TEMPLATE, type CoverSpec, newsDate, pngSize, validateRenderedCover } from "@/src/media/cover-spec";
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

function draftOf(version: VersionToRender): ScriptDraft {
  const draft = storedDraftSchema.safeParse(version.content);
  if (!draft.success) throw new Error("render_script_invalid");
  return draft.data;
}

function specFor(draft: ScriptDraft, version: VersionToRender, audioPath: string, durationSeconds: number): RenderSpec {
  try {
    return buildRenderSpec(draft, citedPublishers(draft, version.evidence), audioPath, durationSeconds);
  } catch {
    throw new Error("render_spec_invalid");
  }
}

/** The cover of the same approved version: its checked cover text, its cited sources, the date of its newest source. */
function coverSpecFor(draft: ScriptDraft, version: VersionToRender, versionId: string, now: Date): CoverSpec {
  const cited = new Set([...draft.sentences, ...(draft.cover ? [draft.cover] : [])].flatMap((item) => item.evidence.map((ref) => ref.evidenceId)));
  try {
    return buildCoverSpec(draft, citedPublishers(draft, version.evidence), newsDate(version.evidence, cited, now), versionId);
  } catch {
    throw new Error("render_cover_spec_invalid");
  }
}

async function produce(deps: RenderJobDeps, job: ClaimedJob): Promise<Record<string, unknown>> {
  const { store, engine } = deps;
  const version = await store.loadVersionToRender(job.scriptVersionId);
  if (!version?.approved) throw new Error("script_not_approved");
  const audio = await store.loadAudioAsset(job.scriptVersionId);
  if (!audio) throw new Error("render_audio_missing");

  const draft = draftOf(version);
  const now = (deps.now ?? (() => new Date()))();
  const dir = await mkdtemp(join(tmpdir(), "ogniora-render-"));
  try {
    const audioFile = join(dir, "audio.mp3");
    const videoFile = join(dir, "video.mp4");
    const coverFile = join(dir, "cover.png");

    // The cover first: it is quick, and a cover that cannot be drawn stops the job before the long render.
    const coverSpec = coverSpecFor(draft, version, job.scriptVersionId, now);
    const renderedCover = await engine.renderCover(coverSpec, coverFile);
    const cover = await readFile(coverFile);
    const header = pngSize(cover);
    const [coverProblem] = validateRenderedCover({ ...renderedCover, ...(header ?? { width: 0, height: 0 }), sizeBytes: cover.byteLength });
    if (coverProblem) throw new Error(`render_cover_${coverProblem}`);

    await writeFile(audioFile, await store.downloadFile(audio.storagePath));
    const durationSeconds = await engine.probeDuration(audioFile);
    const spec = specFor(draft, version, audio.storagePath, durationSeconds);
    const rendered = await engine.render(spec, audioFile, videoFile);
    const [problem] = validateRenderedVideo(rendered, spec);
    if (problem) throw new Error(`render_${problem}`);

    const days = await store.loadPreviewRetentionDays();
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
    // Stable path per version: a rerun overwrites the same file and the same asset row.
    const coverPath = `thumbnail/${job.scriptVersionId}/${COVER_TEMPLATE}.png`;
    await store.saveFile(coverPath, cover, "image/png");
    const thumbnailAssetId = await store.recordAsset({
      ...shared,
      kind: "thumbnail",
      mimeType: "image/png",
      storagePath: coverPath,
      sizeBytes: cover.byteLength,
      sha256: sha256(cover),
      rights: {
        template: COVER_TEMPLATE,
        engine: engine.name,
        imagery: "original_vector_illustration",
        visual: coverSpec.visual,
        text: coverSpec.textSource === "cover" ? "approved_script_cover" : "approved_script_title",
        licence: "owned",
      },
    });
    return { videoAssetId, thumbnailAssetId, durationSeconds: rendered.durationSeconds, sizeBytes: video.byteLength };
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
