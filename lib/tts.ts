/**
 * lib/tts.ts — Multi-provider Text-to-Speech
 *
 * Switch provider via env var:
 *   TTS_PROVIDER=azure       → Azure Cognitive Services (free tier 500k chars/mese, poi $1/1M)
 *   TTS_PROVIDER=elevenlabs  → ElevenLabs ($5–$99/mese)
 */

// ─── ElevenLabs ───────────────────────────────────────────────────────────────

export const ELEVENLABS_VOICES = [
  { id: "pNInz6obpgDQGcFmaJgB", label: "Adam (uomo, neutro)" },
  { id: "EXAVITQu4vr4xnSDxMaL", label: "Bella (donna, chiara)" },
  { id: "onwK4e9ZLuTAKqWW03F9", label: "Daniel (uomo, profondo)" },
  { id: "XB0fDUnXU5powFXDhCwa", label: "Charlotte (donna, calda)" },
] as const;

async function elevenLabsVoiceover(
  text: string,
  voiceId: string = ELEVENLABS_VOICES[0].id
): Promise<ArrayBuffer> {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`ElevenLabs error ${res.status}: ${err}`);
  }
  return res.arrayBuffer();
}

// ─── Azure Cognitive Services TTS ────────────────────────────────────────────
// Free tier: 500.000 caratteri/mese (Neural) — poi $1 ogni milione
// Richiede: AZURE_TTS_KEY + AZURE_TTS_REGION

export const AZURE_VOICES = [
  { id: "it-IT-DiegoNeural",    label: "Diego (uomo, italiano)" },
  { id: "it-IT-ElsaNeural",     label: "Elsa (donna, italiana)" },
  { id: "it-IT-IsabellaNeural", label: "Isabella (donna, italiana)" },
  { id: "it-IT-GiuseppeNeural", label: "Giuseppe (uomo, italiano)" },
] as const;

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function azureVoiceover(
  text: string,
  voice: string = process.env.AZURE_TTS_VOICE || "it-IT-DiegoNeural"
): Promise<ArrayBuffer> {
  const key    = process.env.AZURE_TTS_KEY!;
  const region = process.env.AZURE_TTS_REGION || "westeurope";

  // Step 1: ottieni token di autenticazione
  const tokenRes = await fetch(
    `https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`,
    { method: "POST", headers: { "Ocp-Apim-Subscription-Key": key } }
  );
  if (!tokenRes.ok) throw new Error(`Azure token error ${tokenRes.status}`);
  const token = await tokenRes.text();

  // Step 2: sintetizza audio via SSML
  const ssml = `
    <speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="it-IT">
      <voice name="${voice}">
        <prosody rate="0%" pitch="0%">
          ${escapeXml(text)}
        </prosody>
      </voice>
    </speak>`.trim();

  const audioRes = await fetch(
    `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,
    {
      method: "POST",
      headers: {
        "Authorization":  `Bearer ${token}`,
        "Content-Type":   "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
        "User-Agent":     "flash-info",
      },
      body: ssml,
    }
  );
  if (!audioRes.ok) {
    const err = await audioRes.text();
    throw new Error(`Azure TTS error ${audioRes.status}: ${err}`);
  }
  return audioRes.arrayBuffer();
}

// ─── Entrypoint unificato ─────────────────────────────────────────────────────

export async function generateVoiceover(
  text: string,
  voiceId?: string
): Promise<ArrayBuffer> {
  const provider = process.env.TTS_PROVIDER || "elevenlabs";

  if (provider === "azure") {
    return azureVoiceover(text, voiceId);
  }
  return elevenLabsVoiceover(text, voiceId);
}
