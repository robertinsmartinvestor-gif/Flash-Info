// Renders invented text over silence, and a cover with invented text: proves the template and the runner without
// touching Supabase, a provider or a real script, so the output may be public.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { render, renderCover } from "./render.mjs";

const here = dirname(fileURLToPath(import.meta.url));

function silentWav(seconds, rate = 24000) {
  const bytes = seconds * rate * 2;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + bytes, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(bytes, 40);
  return Buffer.concat([header, Buffer.alloc(bytes)]);
}

const out = join(here, "out");
await mkdir(out, { recursive: true });
const spec = JSON.parse(await readFile(join(here, "sample-spec.json"), "utf8"));
const audioPath = join(out, "silence.wav");
await writeFile(audioPath, silentWav(spec.durationSeconds));
const started = Date.now();
const result = await render({ spec, audioPath, outputPath: join(out, "sample.mp4"), stillPath: join(out, "sample.png"), stillAtSeconds: 3 });
console.log(JSON.stringify({ ...result, renderSeconds: Math.round((Date.now() - started) / 1000) }));

const coverSpec = JSON.parse(await readFile(join(here, "sample-cover.json"), "utf8"));
const visuals = process.env.SAMPLE_ALL_VISUALS ? ["carburante", "economia", "politica", "esteri", "giustizia", "salute", "meteo", "trasporti", "lavoro", "tecnologia", "ambiente", "generico"] : [coverSpec.visual];
for (const [index, visual] of visuals.entries()) {
  const name = visuals.length === 1 ? "sample-cover.png" : `sample-cover-${visual}.png`;
  const cover = await renderCover({ spec: { ...coverSpec, visual, seed: coverSpec.seed + index * 7919 }, outputPath: join(out, name) });
  console.log(JSON.stringify({ cover: name, ...cover }));
}
