export interface TtsResult {
  audio: Uint8Array;
  mimeType: "audio/mpeg";
  characters: number;
  /** Word timings when the provider gives them; captions fall back to estimates. */
  wordTimings: Array<{ word: string; startSeconds: number }> | null;
}

export interface TtsProvider {
  readonly name: string;
  synthesize(text: string, voice?: string): Promise<TtsResult>;
}

const AZURE_VOICES = new Set([
  "it-IT-DiegoNeural",
  "it-IT-ElsaNeural",
  "it-IT-IsabellaNeural",
  "it-IT-GiuseppeNeural",
  "it-IT-Alessio:DragonHDLatestNeural",
  "it-IT-Isabella:DragonHDLatestNeural",
]);
const AZURE_REGION = /^[a-z0-9]{3,32}$/;
/** Per-file limit reported for the free tier: exceeding it fails, it does not truncate. */
const AZURE_MAX_CHARACTERS = 3000;
const TIMEOUT_MS = 60_000;

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function buildSsml(text: string, voice: string): string {
  if (!AZURE_VOICES.has(voice)) throw new Error("tts_voice_not_allowed");
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="it-IT"><voice name="${voice}">${escapeXml(text)}</voice></speak>`;
}

export function createAzureTts(key: string, region: string, defaultVoice = "it-IT-DiegoNeural", fetchImpl: typeof fetch = fetch): TtsProvider {
  if (!AZURE_REGION.test(region)) throw new Error("tts_invalid_region");
  return {
    name: "azure",
    async synthesize(text, voice = defaultVoice) {
      if (text.length > AZURE_MAX_CHARACTERS) throw new Error("tts_text_too_long");
      const response = await fetchImpl(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": key,
          "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": "audio-24khz-96kbitrate-mono-mp3",
          "User-Agent": "ogniora",
        },
        body: buildSsml(text, voice),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`tts_azure_${response.status}`);
      return { audio: new Uint8Array(await response.arrayBuffer()), mimeType: "audio/mpeg", characters: text.length, wordTimings: null };
    },
  };
}

export function createElevenLabsTts(key: string, defaultVoice: string, fetchImpl: typeof fetch = fetch): TtsProvider {
  return {
    name: "elevenlabs",
    async synthesize(text, voice = defaultVoice) {
      if (!/^[A-Za-z0-9]{10,40}$/.test(voice)) throw new Error("tts_voice_not_allowed");
      const response = await fetchImpl(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
        method: "POST",
        headers: { "xi-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({ text, model_id: "eleven_multilingual_v2" }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`tts_elevenlabs_${response.status}`);
      return { audio: new Uint8Array(await response.arrayBuffer()), mimeType: "audio/mpeg", characters: text.length, wordTimings: null };
    },
  };
}

const GOOGLE_ENDPOINT = "https://eu-texttospeech.googleapis.com/v1/text:synthesize";
const GOOGLE_VOICE = /^it-IT-Chirp3-HD-[A-Z][a-z]+$/;

export interface GoogleCredentials {
  client_email: string;
  private_key: string;
}

/** The error stays fixed on purpose: JSON.parse errors can quote the input, and job logs are public. */
export function parseGoogleCredentials(json: string): GoogleCredentials {
  try {
    const { client_email, private_key } = JSON.parse(json) as Partial<GoogleCredentials>;
    if (typeof client_email === "string" && typeof private_key === "string") return { client_email, private_key };
  } catch {
    // Reported below, without the cause.
  }
  throw new Error("invalid_google_credentials");
}

/** Cloud TTS documents OAuth credentials, not API keys, so this takes a token source. */
export function createGoogleTts(getToken: () => Promise<string>, defaultVoice = "it-IT-Chirp3-HD-Charon", fetchImpl: typeof fetch = fetch): TtsProvider {
  return {
    name: "google",
    async synthesize(text, voice = defaultVoice) {
      if (!GOOGLE_VOICE.test(voice)) throw new Error("tts_voice_not_allowed");
      const response = await fetchImpl(GOOGLE_ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${await getToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ input: { text }, voice: { languageCode: "it-IT", name: voice }, audioConfig: { audioEncoding: "MP3" } }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`tts_google_${response.status}`);
      const { audioContent } = (await response.json()) as { audioContent?: string };
      if (!audioContent) throw new Error("tts_google_empty");
      return { audio: new Uint8Array(Buffer.from(audioContent, "base64")), mimeType: "audio/mpeg", characters: text.length, wordTimings: null };
    },
  };
}
