import type { TtsProvider } from "./tts";
import { VOICE_CATALOG, type VoiceProvider } from "./voices";

export type TestProvider = VoiceProvider;

export interface TestVoice {
  provider: TestProvider;
  voice: string;
}

export interface TestSample {
  id: string;
  text: string;
}

export interface TestResult extends TestVoice {
  label: string;
  sample: string;
  status: "ok" | "skipped" | "failed";
  characters: number;
  reason?: string;
}

/** One male and one female voice per provider. */
export const TEST_VOICES: readonly TestVoice[] = VOICE_CATALOG.map(({ provider, voice }) => ({ provider, voice }));

/** List prices per million characters. Google's first million each month is free. */
export const LIST_PRICE_PER_MILLION: Record<TestProvider, number> = { google: 30, azure: 22 };

/** Everything a newscast trips on. It is a pronunciation drill, so it reports no event. */
export const PRONUNCIATION_SAMPLE =
  "Prova di pronuncia. Volodymyr Zelensky, Donald Trump, Ursula von der Leyen. " +
  "Anac, Istat, Inps, Bce, Nato. Wall Street, Bruxelles, Reggio Calabria. " +
  "Il 12 novembre 2026, 1.250 persone, il 3,5 per cento, 48 miliardi di euro.";

export function assignLabels(voices: readonly TestVoice[], random: () => number = Math.random): Array<TestVoice & { label: string }> {
  const shuffled = [...voices];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[other]] = [shuffled[other]!, shuffled[index]!];
  }
  return shuffled.map((voice, index) => ({ ...voice, label: String.fromCharCode(65 + index) }));
}

/** Provider failures keep their code; anything else may carry credential text, so it is dropped. */
function reasonFrom(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return /^tts_[a-z0-9_]{1,40}$/.test(message) ? message : "tts_failed";
}

/** One voice failing must not cost the others, so failures are recorded and the run goes on. */
export async function runListeningTest(input: {
  voices: Array<TestVoice & { label: string }>;
  samples: readonly TestSample[];
  synthesizers: Partial<Record<TestProvider, TtsProvider>>;
  save: (fileName: string, audio: Uint8Array) => Promise<void>;
}): Promise<TestResult[]> {
  const results: TestResult[] = [];
  for (const voice of input.voices) {
    const synthesizer = input.synthesizers[voice.provider];
    for (const sample of input.samples) {
      const base = { ...voice, sample: sample.id };
      if (!synthesizer) {
        results.push({ ...base, status: "skipped", characters: 0, reason: "no_credentials" });
        continue;
      }
      try {
        const audio = await synthesizer.synthesize(sample.text, voice.voice);
        await input.save(`${voice.label}-${sample.id}.mp3`, audio.audio);
        results.push({ ...base, status: "ok", characters: audio.characters });
      } catch (error) {
        results.push({ ...base, status: "failed", characters: 0, reason: reasonFrom(error) });
      }
    }
  }
  return results;
}

export function testCostUsd(results: readonly TestResult[]): number {
  return results.reduce((total, result) => total + (result.characters * LIST_PRICE_PER_MILLION[result.provider]) / 1_000_000, 0);
}
