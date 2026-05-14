export const VOICES = [
  { id: "pNInz6obpgDQGcFmaJgB", label: "Adam (uomo, neutro)" },
  { id: "EXAVITQu4vr4xnSDxMaL", label: "Bella (donna, chiara)" },
  { id: "onwK4e9ZLuTAKqWW03F9", label: "Daniel (uomo, profondo)" },
  { id: "XB0fDUnXU5powFXDhCwa", label: "Charlotte (donna, calda)" },
] as const;

export async function generateVoiceover(
  text: string,
  voiceId: string = VOICES[0].id
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
