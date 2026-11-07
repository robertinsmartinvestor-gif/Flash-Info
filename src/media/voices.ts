export type VoiceProvider = "google" | "azure";

export interface VoiceOption {
  provider: VoiceProvider;
  voice: string;
  label: string;
  /** False until the voice has produced real audio with real credentials. */
  verified: boolean;
}

/** Must match the list in `set_tts_voice`: a test checks every entry against the database. */
export const VOICE_CATALOG: readonly VoiceOption[] = [
  { provider: "google", voice: "it-IT-Chirp3-HD-Charon", label: "Charon (Google, uomo)", verified: true },
  { provider: "google", voice: "it-IT-Chirp3-HD-Kore", label: "Kore (Google, donna)", verified: true },
  { provider: "azure", voice: "it-IT-Alessio:DragonHDLatestNeural", label: "Alessio HD (Azure, uomo)", verified: false },
  { provider: "azure", voice: "it-IT-Isabella:DragonHDLatestNeural", label: "Isabella HD (Azure, donna)", verified: false },
];

/** Reads the `tts_voice` setting. Null when it is not a catalog voice, so nobody synthesizes with it. */
export function findVoice(setting: unknown): VoiceOption | null {
  if (typeof setting !== "object" || setting === null) return null;
  const { provider, voice } = setting as Partial<VoiceOption>;
  return VOICE_CATALOG.find((option) => option.provider === provider && option.voice === voice) ?? null;
}
