/**
 * lib/youtube.ts — Upload video su YouTube
 * Usa OAuth2 con refresh token (no interazione utente richiesta)
 */

import { instance as gaxiosInstance } from "gaxios";
import { google } from "googleapis";

// Use Node's native fetch to avoid ERR_STREAM_PREMATURE_CLOSE on Node 24
// (node-fetch has a gzip decompression bug that triggers during OAuth2 token refresh).
gaxiosInstance.defaults.fetchImplementation = globalThis.fetch;

function getYouTubeClient() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET
  );
  oauth2Client.setCredentials({
    refresh_token: process.env.YOUTUBE_REFRESH_TOKEN,
  });
  return google.youtube({ version: "v3", auth: oauth2Client });
}

export interface UploadOptions {
  title: string;
  description: string;
  tags?: string[];
  videoPath: string; // path locale al file MP4
}

export async function uploadToYouTube(options: UploadOptions): Promise<string> {
  const youtube = getYouTubeClient();
  const { createReadStream } = await import("fs");

  const res = await youtube.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: {
        title:       options.title,
        description: options.description,
        tags:        options.tags || ["notizie", "italia", "flash info", "ogniora"],
        categoryId:  "25", // News & Politics
        defaultLanguage: "it",
      },
      status: {
        privacyStatus: "public",
        selfDeclaredMadeForKids: false,
      },
    },
    media: {
      mimeType: "video/mp4",
      body:     createReadStream(options.videoPath),
    },
  });

  const videoId = res.data.id!;
  console.log(`[YouTube] Video pubblicato: https://youtube.com/watch?v=${videoId}`);
  return videoId;
}

export function buildTitle(categoria: string, notizie: { titolo: string }[]): string {
  const now = new Date().toLocaleString("it-IT", {
    hour: "2-digit", minute: "2-digit",
    day: "2-digit", month: "long",
  });
  return `🔴 Flash Info ${categoria} — ${now}`;
}

export function buildDescription(notizie: { titolo: string; testo: string }[]): string {
  const elenco = notizie.map((n, i) => `${i + 1}. ${n.titolo}`).join("\n");
  return `Le principali notizie di oggi in pochi minuti.\n\n${elenco}\n\n#FlashInfo #Notizie #OgniOra`;
}
