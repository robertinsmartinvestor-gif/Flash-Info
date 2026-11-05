import { describe, expect, it, vi } from "vitest";
import { buildCaptions, toSrt, toVtt } from "@/src/media/captions";
import { buildRenderSpec, validateRenderedVideo } from "@/src/media/render-spec";
import { buildSsml, createAzureTts, createElevenLabsTts } from "@/src/media/tts";
import { validDraft } from "../helpers/fixtures";

describe("tts", () => {
  it("escapes hostile text in SSML", () => {
    const ssml = buildSsml(`</voice><voice name="x">"a" & 'b'`, "it-IT-ElsaNeural");
    expect(ssml).not.toContain('<voice name="x">');
    expect(ssml).toContain("&lt;/voice&gt;");
  });

  it("refuses voices outside the allowlist", () => {
    expect(() => buildSsml("ciao", `x"><audio src="y`)).toThrow("tts_voice_not_allowed");
  });

  it("refuses a malformed region, which would change the request host", () => {
    expect(() => createAzureTts("k", "evil.test/#")).toThrow("tts_invalid_region");
  });

  it("calls Azure and reports characters", async () => {
    const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2]), { status: 200 }));
    const result = await createAzureTts("k", "westeurope", undefined, fetcher as unknown as typeof fetch).synthesize("ciao");
    expect(result).toMatchObject({ characters: 4, mimeType: "audio/mpeg" });
    expect(String((fetcher.mock.calls as unknown[][])[0]?.[0])).toContain("westeurope.tts.speech.microsoft.com");
  });

  it("does not expose provider errors", async () => {
    const fetcher = (async () => new Response("key abc invalid", { status: 401 })) as typeof fetch;
    await expect(createAzureTts("k", "westeurope", undefined, fetcher).synthesize("ciao")).rejects.toThrow(/^tts_azure_401$/);
  });

  it("rejects text over the Azure limit before spending", async () => {
    const fetcher = vi.fn();
    await expect(createAzureTts("k", "westeurope", undefined, fetcher as unknown as typeof fetch).synthesize("x".repeat(3001))).rejects.toThrow("tts_text_too_long");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("validates ElevenLabs voices, which end up in a URL path", async () => {
    await expect(createElevenLabsTts("k", "../../admin").synthesize("ciao")).rejects.toThrow("tts_voice_not_allowed");
  });
});

describe("captions", () => {
  const narration = "Il Consiglio dei ministri ha deciso di impugnare la legge regionale del Veneto. Salvini non ha partecipato al voto.";

  it("covers the audio exactly and in order", () => {
    const cues = buildCaptions(narration, 10);
    expect(cues[0]?.startSeconds).toBe(0);
    expect(cues.at(-1)?.endSeconds).toBeCloseTo(10);
    cues.slice(1).forEach((cue, index) => expect(cue.startSeconds).toBeCloseTo(cues[index]!.endSeconds));
  });

  it("keeps cues short enough for a phone", () => {
    for (const cue of buildCaptions(narration, 10)) {
      expect(cue.text.length).toBeLessThanOrEqual(36);
    }
  });

  it("keeps every word", () => {
    expect(buildCaptions(narration, 10).map((cue) => cue.text).join(" ")).toBe(narration);
  });

  it("formats SRT and VTT timestamps", () => {
    const cues = [{ startSeconds: 61.5, endSeconds: 63, text: "ciao" }];
    expect(toSrt(cues)).toBe("1\n00:01:01,500 --> 00:01:03,000\nciao\n");
    expect(toVtt(cues)).toContain("00:01:01.500 --> 00:01:03.000");
  });
});

describe("render spec", () => {
  const spec = () => buildRenderSpec(validDraft(), ["ANSA", "Rai"], "versions/v1/audio.mp3", 45);

  it("describes a vertical video whose scenes fill the audio", () => {
    const result = spec();
    expect(result.frame).toEqual({ width: 1080, height: 1920, fps: 30 });
    expect(result.scenes[0]?.startSeconds).toBe(0);
    expect(result.scenes.at(-1)?.endSeconds).toBeCloseTo(45);
  });

  it("refuses markup or links reaching the renderer", () => {
    const draft = validDraft();
    draft.title = '<img src=x onerror="fetch(1)">';
    expect(() => buildRenderSpec(draft, [], "a.mp3", 45)).toThrow();
    const link = validDraft();
    link.sentences[0]!.text = "Vai su https://evil.test ora.";
    expect(() => buildRenderSpec(link, [], "a.mp3", 45)).toThrow();
  });

  it("refuses path tricks in the audio asset", () => {
    expect(() => buildRenderSpec(validDraft(), [], "a b;rm -rf", 45)).toThrow();
  });

  it("validates the rendered file", () => {
    const ok = { path: "v.mp4", durationSeconds: 45.2, width: 1080, height: 1920, sizeBytes: 1000 };
    expect(validateRenderedVideo(ok, spec())).toEqual([]);
    expect(validateRenderedVideo({ ...ok, width: 1920, height: 1080 }, spec())).toContain("wrong_resolution");
    expect(validateRenderedVideo({ ...ok, durationSeconds: 30 }, spec())).toContain("wrong_duration");
    expect(validateRenderedVideo({ ...ok, sizeBytes: 60 * 1024 * 1024 }, spec())).toContain("file_too_large");
  });
});
