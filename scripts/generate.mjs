/**
 * scripts/generate.mjs
 * Chiamato da GitHub Actions: genera script + audio e li salva in /tmp
 */

import { writeFileSync } from "fs";

const APP_URL     = process.env.APP_URL;
const CRON_SECRET = process.env.CRON_SECRET;

// Step 1: genera script
console.log("[1/2] Genero script...");
const scriptRes = await fetch(`${APP_URL}/api/script`, {
  method:  "POST",
  headers: { "Content-Type": "application/json" },
  body:    JSON.stringify({ categoria: "Italia", numNotizie: 5 }),
});
const { ok, script, error } = await scriptRes.json();
if (!ok) throw new Error(`Script error: ${error}`);

// Salva script in /tmp per usarlo nello step upload
writeFileSync("/tmp/script.json", JSON.stringify(script));
console.log(`    ✓ Script pronto (${script.notizie.length} notizie)`);

// Step 2: genera audio
console.log("[2/2] Genero audio...");
const text = [script.intro, ...script.notizie.map(n => n.testo), script.outro]
  .filter(Boolean).join("\n\n");

const audioRes = await fetch(`${APP_URL}/api/voiceover`, {
  method:  "POST",
  headers: { "Content-Type": "application/json" },
  body:    JSON.stringify({ text }),
});
if (!audioRes.ok) throw new Error(`Voiceover error: ${audioRes.status}`);

const buffer = await audioRes.arrayBuffer();
writeFileSync("/tmp/flash.mp3", Buffer.from(buffer));
console.log(`    ✓ Audio pronto (${Math.round(buffer.byteLength / 1024)} KB)`);
