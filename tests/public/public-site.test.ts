import { describe, expect, it } from "vitest";
import { coverage, toFunnel } from "@/src/editorial/funnel";
import { cleanSources, type DigestItem, groupByRomeDay, jsonLdScript, newsArticleJsonLd, SLUG_PATTERN, toItem } from "@/src/public/digest";
import { findCopiedText, foldWords } from "@/src/public/originality";
import { missingSiteInfo, SITE_INFO, siteUrl } from "@/src/public/site-info";

const sources = [{
  title: "Il governo approva il decreto sulle accise dei carburanti",
  summary: "Il consiglio dei ministri ha approvato nella serata di ieri un decreto che interviene sulle accise dei carburanti per tre mesi.",
}];

describe("originality", () => {
  it("folds case, accents and punctuation like the database", () => {
    expect(foldWords("È l’ora: PIÙ città!")).toEqual(["e", "l", "ora", "piu", "citta"]);
  });

  it("flags copied headlines and summaries, and accepts original text", () => {
    expect(findCopiedText("Il governo approva il decreto sulle accise", "x".repeat(50), sources)[0]).toMatchObject({ field: "headline" });
    expect(findCopiedText("Il governo approva il decreto sulle accise dei carburanti", "", sources)[0]?.field).toBe("headline");
    const summary = "Secondo le fonti il consiglio dei ministri ha approvato nella serata di ieri un decreto atteso.";
    expect(findCopiedText("Accise ridotte per tre mesi", summary, sources)).toEqual([
      { field: "summary", run: "il consiglio dei ministri ha approvato nella serata" },
    ]);
    expect(findCopiedText("Accise ridotte per tre mesi", "Il taglio vale fino a febbraio secondo entrambe le fonti; il costo non è ancora noto.", sources)).toEqual([]);
  });
});

describe("public digest helpers", () => {
  const item = (publishedAt: string, id = publishedAt): DigestItem => ({
    id, slug: "2026-11-08-prova-abc123", headline: "Titolo </script><script>alert(1)</script>", summary: "Sintesi",
    category: "economia", sourceLinks: [{ publisher: "A", url: "https://a.it/x" }], publishedAt, amendedAt: null, amendmentNote: null,
  });

  it("keeps only https sources with a publisher", () => {
    expect(cleanSources([
      { publisher: "Ok", url: "https://ok.it/a" },
      { publisher: "Http", url: "http://no.it/a" },
      { publisher: "Js", url: "javascript:alert(1)" },
      { publisher: "", url: "https://anon.it" },
      "junk",
    ])).toEqual([{ publisher: "Ok", url: "https://ok.it/a" }]);
    expect(cleanSources(null)).toEqual([]);
  });

  it("groups by calendar day in Rome, not UTC", () => {
    // 23:30 UTC on 7 November is 00:30 on 8 November in Rome.
    const groups = groupByRomeDay([item("2026-11-07T23:30:00Z", "late"), item("2026-11-07T10:00:00Z", "morning")]);
    expect(groups.map((group) => [group.key, group.items.map((entry) => entry.id)])).toEqual([
      ["2026-11-08", ["late"]],
      ["2026-11-07", ["morning"]],
    ]);
    expect(groups[0]!.label).toContain("8 novembre 2026");
  });

  it("builds NewsArticle data with real dates and sources, safe inside a script tag", () => {
    const amended = { ...item("2026-11-08T08:00:00Z"), amendedAt: "2026-11-08T09:00:00Z" };
    const data = newsArticleJsonLd(amended, "https://ogniora.example", null);
    expect(data).toMatchObject({ datePublished: "2026-11-08T08:00:00Z", dateModified: "2026-11-08T09:00:00Z", isBasedOn: ["https://a.it/x"] });
    expect(data).not.toHaveProperty("image");
    expect(data).not.toHaveProperty("author");
    const script = jsonLdScript(data);
    expect(script).not.toContain("</script>");
    expect(JSON.parse(script)).toEqual(data);
  });

  it("maps rows and validates slugs", () => {
    expect(toItem({ id: "1", slug: "s", headline: "h", summary: "s", category: null, source_links: [], published_at: "p", amended_at: null, amendment_note: null }).sourceLinks).toEqual([]);
    expect(SLUG_PATTERN.test("2026-11-08-accise-ridotte-abc123")).toBe(true);
    for (const bad of ["../etc", "2026-11-08-Accise", "2026-11-08-a,b", "accise"]) expect(SLUG_PATTERN.test(bad)).toBe(false);
  });
});

describe("site info", () => {
  it("never ships invented publisher facts: every missing field is listed", () => {
    expect(missingSiteInfo({ ...SITE_INFO, publisherName: "  " })).toContain("publisherName");
    const filled = Object.fromEntries(Object.keys(SITE_INFO).map((key) => [key, "valore"])) as unknown as typeof SITE_INFO;
    expect(missingSiteInfo(filled)).toEqual([]);
  });

  it("derives the canonical origin from configuration only", () => {
    expect(siteUrl({ OGNIORA_SITE_URL: "https://ogniora.it/" })).toBe("https://ogniora.it");
    expect(siteUrl({ OGNIORA_SITE_URL: "javascript:alert(1)", VERCEL_PROJECT_PRODUCTION_URL: "ogniora.vercel.app" })).toBe("https://ogniora.vercel.app");
    expect(siteUrl({})).toBe("http://localhost:3000");
  });
});

describe("funnel coverage", () => {
  const now = Date.parse("2026-11-09T12:00:00Z");
  it("marks counters introduced less than 24 hours ago as partial", () => {
    expect(coverage("2026-11-09T08:00:00Z", now).complete).toBe(false);
    expect(coverage("2026-11-08T08:00:00Z", now).complete).toBe(true);
    expect(coverage(null, now).complete).toBe(false);
  });

  it("turns bigint strings into numbers and keeps dates", () => {
    expect(toFunnel({ events_seen: "4", classified_since: "2026-11-09T08:00:00Z" })).toEqual({ events_seen: 4, classified_since: "2026-11-09T08:00:00Z" });
    expect(toFunnel(null)).toBeNull();
  });
});
