import { describe, expect, it } from "vitest";
import { scriptDraftSchema, storedDraftSchema } from "@/src/editorial/schema";
import { buildCoverSpec, coverDateLabel, coverSeed, guessVisual, newsDate, pngSize, validateRenderedCover } from "@/src/media/cover-spec";
import { validDraft, withoutCover } from "../helpers/fixtures";

const DATE = new Date("2026-11-08T07:30:00Z");

describe("buildCoverSpec", () => {
  it("uses the cover text of the approved version as it is", () => {
    const spec = buildCoverSpec(validDraft(), ["ANSA", "Rai"], DATE, "version-1");
    expect(spec).toMatchObject({
      template: "cover-v1",
      frame: { width: 1080, height: 1920 },
      headline: "Il governo impugna la legge del Veneto",
      qualifier: "",
      subline: "La legge era stata approvata 3 mesi fa",
      dateLabel: "8 NOV 2026",
      sources: ["ANSA", "Rai"],
      visual: "politica",
      textSource: "cover",
    });
  });

  it("falls back to the checked title, and no other claim, for a version saved before covers existed", () => {
    const older = withoutCover();
    const spec = buildCoverSpec(older, ["ANSA"], DATE, "version-1");
    expect(spec).toMatchObject({ headline: older.title, qualifier: "", subline: "", textSource: "title_fallback", visual: "politica" });
  });

  it("refuses markup and links in any text it would draw", () => {
    const draft = validDraft();
    draft.cover!.headline = "<img src=x onerror=alert(1)>";
    expect(() => buildCoverSpec(draft, [], DATE, "v")).toThrow();
    expect(() => buildCoverSpec(validDraft(), ["https://evil.test"], DATE, "v")).toThrow();
  });

  it("changes the composition from one version to the next, the same way every time", () => {
    expect(coverSeed("a")).toBe(coverSeed("a"));
    expect(coverSeed("a")).not.toBe(coverSeed("b"));
  });

  it("dates the cover with the newest cited source, in Rome time", () => {
    const evidence = [
      { evidenceId: "E1", publishedAt: "2026-11-07T22:30:00Z" },
      { evidenceId: "E2", publishedAt: "2026-11-01T10:00:00Z" },
      { evidenceId: "E3", publishedAt: "2026-11-09T10:00:00Z" },
    ];
    const date = newsDate(evidence, new Set(["E1", "E2"]), DATE);
    expect(coverDateLabel(date)).toBe("7 NOV 2026");
    expect(coverDateLabel(new Date("2026-11-07T23:30:00Z"))).toBe("8 NOV 2026");
    expect(newsDate("broken", new Set(), DATE)).toBe(DATE);
  });

  it("guesses a theme from words, generic when nothing matches", () => {
    expect(guessVisual("Accise sul gasolio")).toBe("carburante");
    expect(guessVisual("Una storia qualsiasi")).toBe("generico");
  });
});

describe("cover schema", () => {
  it("requires a cover from the model but accepts stored versions without one", () => {
    const older = withoutCover();
    expect(scriptDraftSchema.safeParse(older).success).toBe(false);
    expect(storedDraftSchema.safeParse(older).success).toBe(true);
    expect(scriptDraftSchema.safeParse(validDraft()).success).toBe(true);
  });

  it("allows only the listed qualifiers", () => {
    const draft = validDraft();
    expect(scriptDraftSchema.safeParse({ ...draft, cover: { ...draft.cover, qualifier: "PER ORA" } }).success).toBe(true);
    expect(scriptDraftSchema.safeParse({ ...draft, cover: { ...draft.cover, qualifier: "ESCLUSIVO" } }).success).toBe(false);
  });
});

describe("rendered cover validation", () => {
  const png = (width: number, height: number) => {
    const bytes = new Uint8Array(24);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    new DataView(bytes.buffer).setUint32(16, width);
    new DataView(bytes.buffer).setUint32(20, height);
    return bytes;
  };

  it("reads the size from the PNG header", () => {
    expect(pngSize(png(1080, 1920))).toEqual({ width: 1080, height: 1920 });
    expect(pngSize(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it("accepts only a non-empty 1080x1920 file within 2 MB", () => {
    expect(validateRenderedCover({ path: "c.png", width: 1080, height: 1920, sizeBytes: 1000 })).toEqual([]);
    expect(validateRenderedCover({ path: "c.png", width: 1920, height: 1080, sizeBytes: 1000 })).toEqual(["wrong_resolution"]);
    expect(validateRenderedCover({ path: "c.png", width: 1080, height: 1920, sizeBytes: 0 })).toEqual(["empty_file"]);
    expect(validateRenderedCover({ path: "c.png", width: 1080, height: 1920, sizeBytes: 3 * 1024 * 1024 })).toEqual(["file_too_large"]);
  });
});
