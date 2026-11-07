import { z } from "zod";
import type { ScriptDraft } from "@/src/editorial/schema";
import { buildCaptions } from "./captions";

export const FRAME = { width: 1080, height: 1920, fps: 30 } as const;

/** Keeps text clear of the YouTube Shorts interface. */
export const SAFE_AREA = { top: 220, bottom: 420, left: 60, right: 140 } as const;

const plainText = z.string().max(400).refine((value) => !/[<>]|https?:|javascript:/i.test(value), "must be plain text");

export const renderSpecSchema = z.object({
  template: z.enum(["flash-v1"]),
  frame: z.object({ width: z.literal(1080), height: z.literal(1920), fps: z.literal(30) }),
  durationSeconds: z.number().positive().max(180),
  audioAsset: z.string().regex(/^[\w/.-]+$/),
  title: plainText,
  sources: z.array(plainText).max(12),
  scenes: z.array(z.object({ startSeconds: z.number().min(0), endSeconds: z.number().positive(), text: plainText })),
  captions: z.array(z.object({ startSeconds: z.number().min(0), endSeconds: z.number().positive(), text: plainText })),
});

export type RenderSpec = z.infer<typeof renderSpecSchema>;

/**
 * Everything a video engine may receive. It is validated data with no HTML or
 * URLs, so text that originated in a news feed cannot act on the renderer.
 * Editorial code depends on this and on VideoEngine, never on an engine.
 */
export function buildRenderSpec(draft: ScriptDraft, sources: string[], audioAsset: string, durationSeconds: number): RenderSpec {
  const narration = draft.sentences.map((sentence) => sentence.text).join(" ");
  const total = narration.length;
  let cursor = 0;
  const scenes = draft.sentences.map((sentence) => {
    const startSeconds = cursor;
    cursor += ((sentence.text.length + 1) / (total + 1)) * durationSeconds;
    return { startSeconds, endSeconds: Math.min(cursor, durationSeconds), text: sentence.text };
  });
  return renderSpecSchema.parse({
    template: "flash-v1",
    frame: FRAME,
    durationSeconds,
    audioAsset,
    title: draft.title,
    sources,
    scenes,
    captions: buildCaptions(narration, durationSeconds),
  });
}

export interface RenderedVideo {
  path: string;
  durationSeconds: number;
  width: number;
  height: number;
  sizeBytes: number;
}

export interface VideoEngine {
  readonly name: string;
  render(spec: RenderSpec, outputPath: string): Promise<RenderedVideo>;
}

/** 50 MB is the per-file limit of Supabase Storage on the free plan. */
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

export function validateRenderedVideo(video: RenderedVideo, spec: RenderSpec): string[] {
  const problems: string[] = [];
  if (video.width !== spec.frame.width || video.height !== spec.frame.height) problems.push("wrong_resolution");
  if (Math.abs(video.durationSeconds - spec.durationSeconds) > 1) problems.push("wrong_duration");
  if (video.sizeBytes === 0) problems.push("empty_file");
  if (video.sizeBytes > MAX_VIDEO_BYTES) problems.push("file_too_large");
  return problems;
}
