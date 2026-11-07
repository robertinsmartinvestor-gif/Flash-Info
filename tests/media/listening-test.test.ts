import { describe, expect, it, vi } from "vitest";
import { assignLabels, runListeningTest, TEST_VOICES, testCostUsd } from "@/src/media/listening-test";
import { buildSsml, createGoogleTts, parseGoogleCredentials, type TtsProvider } from "@/src/media/tts";

const SAMPLES = [{ id: "script", text: "ciao" }];

function synthesizer(fail = false): TtsProvider {
  return {
    name: "fake",
    synthesize: async (text) => {
      if (fail) throw new Error("tts_azure_401");
      return { audio: new Uint8Array([1]), mimeType: "audio/mpeg", characters: text.length, wordTimings: null };
    },
  };
}

describe("createGoogleTts", () => {
  const ok = () => new Response(JSON.stringify({ audioContent: Buffer.from([1, 2, 3]).toString("base64") }), { status: 200 });

  it("uses the EU endpoint and decodes the audio", async () => {
    const fetcher = vi.fn(async () => ok());
    const result = await createGoogleTts(async () => "token", undefined, fetcher as unknown as typeof fetch).synthesize("ciao");
    expect([...result.audio]).toEqual([1, 2, 3]);
    expect(result).toMatchObject({ characters: 4, mimeType: "audio/mpeg" });
    const [url, init] = (fetcher.mock.calls as unknown as Array<[string, RequestInit]>)[0]!;
    expect(url).toBe("https://eu-texttospeech.googleapis.com/v1/text:synthesize");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer token");
    expect(JSON.parse(String(init.body))).toMatchObject({ voice: { languageCode: "it-IT", name: "it-IT-Chirp3-HD-Charon" } });
  });

  it("refuses voices outside the expected family", async () => {
    await expect(createGoogleTts(async () => "t").synthesize("ciao", "../admin")).rejects.toThrow("tts_voice_not_allowed");
  });

  it("does not expose provider errors", async () => {
    const fetcher = (async () => new Response("secret detail", { status: 403 })) as typeof fetch;
    await expect(createGoogleTts(async () => "t", undefined, fetcher).synthesize("ciao")).rejects.toThrow(/^tts_google_403$/);
  });

  it("rejects a response without audio", async () => {
    const fetcher = (async () => new Response("{}", { status: 200 })) as typeof fetch;
    await expect(createGoogleTts(async () => "t", undefined, fetcher).synthesize("ciao")).rejects.toThrow("tts_google_empty");
  });
});

describe("parseGoogleCredentials", () => {
  it("reads a service account key", () => {
    const json = JSON.stringify({ client_email: "a@b.iam.gserviceaccount.com", private_key: "k", other: 1 });
    expect(parseGoogleCredentials(json)).toEqual({ client_email: "a@b.iam.gserviceaccount.com", private_key: "k" });
  });

  it("never repeats the secret in its error", () => {
    let message = "";
    try {
      parseGoogleCredentials('{"private_key": "SUPERSECRET"');
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe("invalid_google_credentials");
  });
});

describe("azure HD voices", () => {
  it("allows the HD voices under test", () => {
    for (const { voice } of TEST_VOICES.filter((item) => item.provider === "azure")) {
      expect(buildSsml("ciao", voice)).toContain(`name="${voice}"`);
    }
  });
});

describe("assignLabels", () => {
  it("gives each voice one label, in an order that depends on the shuffle", () => {
    const first = assignLabels(TEST_VOICES, () => 0);
    const second = assignLabels(TEST_VOICES, () => 0.99);
    expect(first.map((voice) => voice.label)).toEqual(["A", "B", "C", "D"]);
    expect(new Set(first.map((voice) => voice.voice)).size).toBe(4);
    expect(first.map((voice) => voice.voice)).not.toEqual(second.map((voice) => voice.voice));
  });
});

describe("runListeningTest", () => {
  const voices = assignLabels(TEST_VOICES);
  const label = (provider: string) => voices.find((voice) => voice.provider === provider)!.label;

  it("keeps going when one provider fails", async () => {
    const save = vi.fn(async () => undefined);
    const results = await runListeningTest({ voices, samples: SAMPLES, synthesizers: { google: synthesizer(), azure: synthesizer(true) }, save });
    expect(save).toHaveBeenCalledTimes(2);
    expect(results.filter((result) => result.status === "failed").map((result) => result.reason)).toEqual(["tts_azure_401", "tts_azure_401"]);
  });

  it("skips a provider without credentials", async () => {
    const results = await runListeningTest({ voices, samples: SAMPLES, synthesizers: { google: synthesizer() }, save: async () => undefined });
    expect(results.find((result) => result.label === label("azure"))).toMatchObject({ status: "skipped", reason: "no_credentials" });
  });

  it("drops the text of an unexpected error", async () => {
    const leaky: TtsProvider = { name: "x", synthesize: async () => { throw new Error("private_key=abc"); } };
    const results = await runListeningTest({ voices, samples: SAMPLES, synthesizers: { google: leaky }, save: async () => undefined });
    expect(results.find((result) => result.provider === "google")?.reason).toBe("tts_failed");
  });

  it("records a failed save as a failure", async () => {
    const results = await runListeningTest({
      voices,
      samples: SAMPLES,
      synthesizers: { google: synthesizer() },
      save: async () => { throw new Error("tts_storage_upload"); },
    });
    expect(results.find((result) => result.provider === "google")).toMatchObject({ status: "failed", reason: "tts_storage_upload" });
  });
});

describe("testCostUsd", () => {
  it("prices each provider at list", () => {
    const base = { label: "A", sample: "s", status: "ok" as const, voice: "v" };
    expect(testCostUsd([{ ...base, provider: "google", characters: 1_000_000 }, { ...base, provider: "azure", characters: 500_000 }])).toBe(41);
  });
});
