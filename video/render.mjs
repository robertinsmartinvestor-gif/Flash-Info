// The only way into Remotion. The caller gets numbers on stdout; the public log
// gets no script text unless RENDER_VERBOSE is set, which only the sample does.
import { copyFile, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { parseMedia } from "@remotion/media-parser";
import { nodeReader } from "@remotion/media-parser/node";
import { ensureBrowser, renderMedia, renderStill, selectComposition } from "@remotion/renderer";

const here = dirname(fileURLToPath(import.meta.url));

export async function probe(file) {
  const media = await parseMedia({
    src: resolve(file),
    reader: nodeReader,
    fields: { slowDurationInSeconds: true, dimensions: true },
    acknowledgeRemotionLicense: true,
  });
  return { durationSeconds: media.slowDurationInSeconds, width: media.dimensions?.width ?? 0, height: media.dimensions?.height ?? 0 };
}

export async function render({ spec, audioPath, outputPath, stillPath, stillAtSeconds = 0 }) {
  await ensureBrowser();
  const publicDir = await mkdtemp(join(tmpdir(), "ogniora-public-"));
  try {
    const audioFile = `audio${extname(audioPath)}`;
    await copyFile(audioPath, join(publicDir, audioFile));
    const serveUrl = await bundle({ entryPoint: join(here, "src/index.ts"), publicDir });
    const inputProps = { spec, audioFile };
    const composition = await selectComposition({ serveUrl, id: spec.template, inputProps, logLevel: "error" });
    await renderMedia({ serveUrl, composition, inputProps, codec: "h264", crf: 20, pixelFormat: "yuv420p", audioCodec: "aac", outputLocation: outputPath, logLevel: "error" });
    if (stillPath) {
      await renderStill({ serveUrl, composition, inputProps, output: stillPath, frame: Math.round(stillAtSeconds * spec.frame.fps), logLevel: "error" });
    }
  } finally {
    await rm(publicDir, { recursive: true, force: true });
  }
  return { ...(await probe(outputPath)), sizeBytes: (await stat(outputPath)).size };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  try {
    if (command === "probe") {
      console.log(JSON.stringify(await probe(args[0])));
    } else if (command === "render") {
      const [specPath, audioPath, outputPath] = args;
      const spec = JSON.parse(await readFile(specPath, "utf8"));
      console.log(JSON.stringify(await render({ spec, audioPath, outputPath })));
    } else {
      throw new Error("unknown_command");
    }
  } catch (error) {
    console.error(process.env.RENDER_VERBOSE ? error : `render.mjs: ${error?.name ?? "Error"}`);
    process.exitCode = 1;
  }
}
