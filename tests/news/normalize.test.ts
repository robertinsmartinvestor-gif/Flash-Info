import { describe, expect, it } from "vitest";
import { canonicalizeUrl, classify, dedupeArticles, extractEventDate, isLowValue, normalizeItem, parseFeedDate } from "@/src/news/normalize";
import type { FeedItem, NewsSource } from "@/src/news/types";
import { article, NOW } from "../helpers/fixtures";

const source: NewsSource = {
  id: "s", slug: "s1", name: "S", publisher: "Sky TG24", homepageUrl: "https://a.it", feedUrl: "https://a.it/rss", groupKey: "sky", reliability: 0.8,
};
const item = (overrides: Partial<FeedItem> = {}): FeedItem => ({
  title: "Titolo", url: "https://a.it/x", summary: "Sommario", author: null, publishedRaw: "Thu, 05 Nov 2026 18:00:00 GMT", ...overrides,
});
const options = { now: NOW, maxAgeHours: 72 };

describe("parseFeedDate", () => {
  it("parses the Italian dates used by Sky TG24", () => {
    expect(parseFeedDate("gio, 05 nov 2026 22:45:00 GMT")?.toISOString()).toBe("2026-11-05T22:45:00.000Z");
    expect(parseFeedDate("lun, 02 mag 2026 08:00:00 GMT")?.toISOString()).toBe("2026-05-02T08:00:00.000Z");
  });

  it("keeps timezone offsets", () => {
    expect(parseFeedDate("Thu, 5 Nov 2026 21:20:57 +0100")?.toISOString()).toBe("2026-11-05T20:20:57.000Z");
  });

  it("returns null for nonsense", () => {
    expect(parseFeedDate("domani forse")).toBeNull();
    expect(parseFeedDate(null)).toBeNull();
  });
});

describe("normalizeItem", () => {
  it("records publisher and UTC publication time", () => {
    expect(normalizeItem(item(), source, options)).toMatchObject({ publisher: "Sky TG24", publishedAt: "2026-11-05T18:00:00.000Z", groupKey: "sky" });
  });

  it("rejects items that cannot be dated", () => {
    expect(normalizeItem(item({ publishedRaw: null }), source, options)).toBeNull();
  });

  it("rejects stale items, like the 2024 entries still in the Corriere feed", () => {
    expect(normalizeItem(item({ publishedRaw: "Mon, 13 May 2024 06:05:06 +0200" }), source, options)).toBeNull();
  });

  it("rejects future-dated items", () => {
    expect(normalizeItem(item({ publishedRaw: "Fri, 06 Nov 2026 18:00:00 GMT" }), source, options)).toBeNull();
  });
});

describe("extractEventDate", () => {
  const published = new Date("2026-11-05T10:00:00Z");

  it("keeps the event date apart from publication", () => {
    expect(extractEventDate("Ieri sera l'incidente", published)).toBe("2026-11-04T10:00:00.000Z");
    expect(extractEventDate("Oggi il voto", published)).toBe(published.toISOString());
  });

  it("does not guess", () => {
    expect(extractEventDate("Il voto sulla manovra", published)).toBeNull();
  });
});

describe("canonicalizeUrl", () => {
  it("removes tracking and fragments so reposts match", () => {
    expect(canonicalizeUrl("https://WWW.Ansa.it/a/b/?utm_source=rss&id=3&fbclid=x#top")).toBe("https://www.ansa.it/a/b?id=3");
  });
});

describe("classify", () => {
  it("favours the title over a long summary", () => {
    expect(classify("Solo 1-1 a Bergamo tra Atalanta e Kairat", "maltempo e clima in città", null).category).toBe("sport");
  });

  it("marks foreign stories", () => {
    expect(classify("Paraguay, si dimette il presidente", "", null).territory).toBe("WORLD");
  });

  it("uses the fallback when nothing matches", () => {
    expect(classify("Una storia", "", "economia")).toEqual({ category: "economia", territory: "IT" });
  });
});

describe("isLowValue", () => {
  it("recognises services", () => {
    expect(isLowValue("SuperEnalotto, numeri estrazione vincente oggi")).toBe(true);
    expect(isLowValue("Il governo impugna la legge")).toBe(false);
  });
});

describe("dedupeArticles", () => {
  it("drops repeated URLs and same-group copies, keeping other groups", () => {
    const first = article({ canonicalUrl: "https://a/1", contentHash: "h" });
    const sameUrl = article({ canonicalUrl: "https://a/1", contentHash: "other" });
    const sameGroupCopy = article({ canonicalUrl: "https://a/2", contentHash: "h" });
    const otherGroup = article({ canonicalUrl: "https://a/3", contentHash: "h", groupKey: "rai" });
    expect(dedupeArticles([first, sameUrl, sameGroupCopy, otherGroup])).toEqual([first, otherGroup]);
  });
});
