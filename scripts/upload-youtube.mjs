/**
 * scripts/upload-youtube.mjs
 * Chiamato da GitHub Actions: carica /tmp/flash.mp4 su YouTube
 */

import { google } from "googleapis";
import { createReadStream, readFileSync } from "fs";

const script   = JSON.parse(readFileSync("/tmp/script.json", "utf-8"));
const categoria = process.env.NEWS_CATEGORIA || "Italia";

// ── Auth OAuth2 ───────────────────────────────────────────────────────────────

const oauth2Client = new google.auth.OAuth2(
  process.env.YOUTUBE_CLIENT_ID,
  process.env.YOUTUBE_CLIENT_SECRET
);
oauth2Client.setCredentials({
  refresh_token: process.env.YOUTUBE_REFRESH_TOKEN,
});
const youtube = google.youtube({ version: "v3", auth: oauth2Client });

// ── Titolo ────────────────────────────────────────────────────────────────────
// Formato: ● Flash Info Italia — 17 maggio 2026 ore 11:00 #Shorts

const now = new Date();
const data = now.toLocaleDateString("it-IT", {
  day: "numeric", month: "long", year: "numeric",
  timeZone: "Europe/Rome",
});
const ora = now.toLocaleTimeString("it-IT", {
  hour: "2-digit", minute: "2-digit",
  timeZone: "Europe/Rome",
});

const title = `● Flash Info ${categoria} — ${data} ore ${ora} #Shorts`;

// ── Descrizione ───────────────────────────────────────────────────────────────
// Riga 1: elenco titoli notizie
// Riga 2: hashtag

const elencoNotizie = script.notizie
  .map((n, i) => `${i + 1}. ${n.titolo}`)
  .join("\n");

const hashtag = `#notizie #${categoria.toLowerCase()} #shorts #ogniora #flashinfo`;

const description = `${elencoNotizie}\n\n${hashtag}`;

// ── Upload ────────────────────────────────────────────────────────────────────

console.log(`[YouTube] Upload: "${title}"`);

const res = await youtube.videos.insert({
  part: ["snippet", "status"],
  requestBody: {
    snippet: {
      title,
      description,
      tags: ["notizie", categoria.toLowerCase(), "flash info", "ogniora", "shorts"],
      categoryId: "25",
      defaultLanguage: "it",
    },
    status: {
      privacyStatus: "public",
      selfDeclaredMadeForKids: false,
    },
  },
  media: {
    mimeType: "video/mp4",
    body:     createReadStream("/tmp/flash.mp4"),
  },
});

const videoId = res.data.id;
console.log(`✅ Pubblicato: https://youtube.com/watch?v=${videoId}`);
console.log(`   Shorts:     https://youtube.com/shorts/${videoId}`);
