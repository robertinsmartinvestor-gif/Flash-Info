/**
 * scripts/upload-youtube.mjs
 * Chiamato da GitHub Actions: carica /tmp/flash.mp4 su YouTube
 */

import { google } from "googleapis";
import { createReadStream, readFileSync } from "fs";

const script = JSON.parse(readFileSync("/tmp/script.json", "utf-8"));

// ── Auth OAuth2 ───────────────────────────────────────────────────────────────

const oauth2Client = new google.auth.OAuth2(
  process.env.YOUTUBE_CLIENT_ID,
  process.env.YOUTUBE_CLIENT_SECRET
);
oauth2Client.setCredentials({
  refresh_token: process.env.YOUTUBE_REFRESH_TOKEN,
});
const youtube = google.youtube({ version: "v3", auth: oauth2Client });

// ── Titolo e descrizione ──────────────────────────────────────────────────────

const now = new Date().toLocaleString("it-IT", {
  hour: "2-digit", minute: "2-digit",
  day: "2-digit", month: "long",
  timeZone: "Europe/Rome",
});

const title = `🔴 Flash Info Italia — ${now} #Shorts`;

const description = [
  "Le principali notizie italiane di oggi in meno di 60 secondi.",
  "",
  ...script.notizie.map((n, i) => `${i + 1}. ${n.titolo}`),
  "",
  "#FlashInfo #Notizie #Italia #OgniOra #Shorts",
].join("\n");

// ── Upload ────────────────────────────────────────────────────────────────────

console.log(`[YouTube] Upload: "${title}"`);

const res = await youtube.videos.insert({
  part: ["snippet", "status"],
  requestBody: {
    snippet: {
      title,
      description,
      tags: ["notizie", "italia", "flash info", "ogniora", "shorts", "tg"],
      categoryId: "25", // News & Politics
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
