import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { RenderedVideo, RenderSpec, VideoEngine } from "./render-spec";

const run = promisify(execFile);
const RENDER_TIMEOUT_MS = 15 * 60_000;

const probeSchema = z.object({ durationSeconds: z.number().positive() });
const renderedSchema = z.object({
  durationSeconds: z.number().positive(),
  width: z.number(),
  height: z.number(),
  sizeBytes: z.number(),
});

/**
 * Remotion lives in video/ with its own dependencies, so it runs as a separate
 * process. No shell is involved, and the spec travels in a file, never in argv.
 */
export function createRemotionEngine(root = process.cwd()): VideoEngine {
  const cwd = join(root, "video");

  async function call(args: string[]): Promise<unknown> {
    try {
      const { stdout } = await run(process.execPath, ["render.mjs", ...args], { cwd, timeout: RENDER_TIMEOUT_MS, maxBuffer: 1024 * 1024 });
      return JSON.parse(stdout.trim().split("\n").at(-1) ?? "");
    } catch (error) {
      console.error((error as { stderr?: string }).stderr?.slice(0, 200) ?? "render.mjs: no output");
      throw new Error("render_engine_failed");
    }
  }

  return {
    name: "remotion",
    async probeDuration(audioFile) {
      return probeSchema.parse(await call(["probe", audioFile])).durationSeconds;
    },
    async render(spec: RenderSpec, audioFile, outputPath): Promise<RenderedVideo> {
      const specFile = `${outputPath}.json`;
      await writeFile(specFile, JSON.stringify(spec));
      return { path: outputPath, ...renderedSchema.parse(await call(["render", specFile, audioFile, outputPath])) };
    },
  };
}
