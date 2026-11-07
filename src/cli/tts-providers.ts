import { google } from "googleapis";
import { createAzureTts, createGoogleTts, parseGoogleCredentials, type TtsProvider } from "@/src/media/tts";
import type { VoiceProvider } from "@/src/media/voices";

function googleSynthesizer(json: string): TtsProvider {
  const credentials = parseGoogleCredentials(json);
  const auth = new google.auth.GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  return createGoogleTts(async () => {
    const token = await auth.getAccessToken();
    if (!token) throw new Error("tts_google_auth");
    return token;
  });
}

/** Only providers with credentials appear. Empty values count as unset: Actions passes them that way. */
export function synthesizersFromEnv(env: NodeJS.ProcessEnv = process.env): Partial<Record<VoiceProvider, TtsProvider>> {
  const synthesizers: Partial<Record<VoiceProvider, TtsProvider>> = {};
  if (env.GOOGLE_TTS_CREDENTIALS_JSON) synthesizers.google = googleSynthesizer(env.GOOGLE_TTS_CREDENTIALS_JSON);
  if (env.AZURE_TTS_KEY) synthesizers.azure = createAzureTts(env.AZURE_TTS_KEY, env.AZURE_TTS_REGION || "westeurope");
  return synthesizers;
}
