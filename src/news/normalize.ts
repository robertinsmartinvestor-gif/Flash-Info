import { randomUUID } from "node:crypto";
import { foldText, sha256 } from "@/src/core/text";
import type { Article, FeedItem, NewsSource } from "./types";

const TRACKING_PARAMS = /^(utm_.+|fbclid|gclid|ref|refresh_ce|rss|src|cmpid|ncid|amp)$/i;
const MAX_FUTURE_MS = 60 * 60 * 1000;

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  politica: ["governo", "parlamento", "senato", "camera dei deputati", "premier", "ministro", "elezioni", "meloni", "opposizione", "decreto", "referendum", "quirinale", "mattarella"],
  economia: ["pil", "inflazione", "borsa", "spread", "banca", "bce", "istat", "manovra", "tasse", "pensioni", "occupazione", "bollette", "mercati", "utile", "ftse mib", "dividendo"],
  esteri: ["usa", "stati uniti", "casa bianca", "ucraina", "russia", "cina", "israele", "gaza", "iran", "unione europea", "bruxelles", "onu", "nato", "trump", "putin", "netanyahu", "germania", "francia", "regno unito", "spagna", "paraguay", "argentina", "brasile", "india", "giappone", "libano", "siria", "turchia"],
  cronaca: ["polizia", "carabinieri", "arrestato", "arresti", "omicidio", "incidente", "procura", "indagine", "processo", "tribunale", "vigili del fuoco", "morto"],
  tecnologia: ["intelligenza artificiale", "software", "smartphone", "cybersecurity", "startup", "apple", "google", "microsoft", "openai", "chip"],
  salute: ["sanità", "ospedale", "ministero della salute", "vaccino", "virus", "medici", "epidemia"],
  ambiente: ["clima", "maltempo", "alluvione", "terremoto", "allerta meteo", "incendio", "siccità", "protezione civile"],
  sport: ["serie a", "champions", "calcio", "juventus", "inter", "milan", "napoli", "atalanta", "roma", "lazio", "europa league", "gol", "allenatore", "formula 1", "motogp", "tennis", "sinner", "olimpiadi", "partita"],
  cultura: ["cinema", "festival", "mostra", "libro", "teatro", "sanremo", "musica"],
};

const FOREIGN_MARKERS = CATEGORY_KEYWORDS.esteri!;

const MONTHS_IT: Record<string, string> = {
  gen: "Jan", feb: "Feb", mar: "Mar", apr: "Apr", mag: "May", giu: "Jun",
  lug: "Jul", ago: "Aug", set: "Sep", ott: "Oct", nov: "Nov", dic: "Dec",
};

/** Parses a feed date, including Italian RFC-822 variants such as "gio, 05 nov 2026 22:45:00 GMT". */
export function parseFeedDate(raw: string | null): Date | null {
  if (!raw) return null;
  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) return direct;

  const translated = raw
    .replace(/^\s*[a-zà-ú]{3,}\.?,\s*/i, "")
    .replace(/\b(gen|feb|mar|apr|mag|giu|lug|ago|set|ott|nov|dic)[a-z]*\b/i, (month) => MONTHS_IT[month.slice(0, 3).toLowerCase()] ?? month);
  const parsed = new Date(translated);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function canonicalizeUrl(raw: string): string {
  const url = new URL(raw);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

const LOW_VALUE = /\b(superenalotto|lotto|oroscopo|estrazion[ei]|previsioni meteo|meteo oggi|immagini|fotogallery|comunicato stampa del consiglio|offerte|sconti)\b/;

function words(text: string): string {
  return ` ${foldText(text).replace(/[^a-z0-9]+/g, " ")} `;
}

function countHits(haystack: string, keywords: string[]): number {
  return keywords.filter((keyword) => haystack.includes(words(keyword))).length;
}

/** Services and galleries: real items, but not news a video should be built on. */
export function isLowValue(title: string): boolean {
  return LOW_VALUE.test(foldText(title));
}

/** Title matches weigh most: long summaries often mention unrelated topics. */
export function classify(title: string, summary: string, fallback: string | null): { category: string | null; territory: string } {
  const titleWords = words(title);
  const bodyWords = words(summary);
  let best: string | null = null;
  let bestHits = 0;
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    const hits = countHits(titleWords, keywords) * 3 + countHits(bodyWords, keywords);
    if (hits > bestHits) {
      best = category;
      bestHits = hits;
    }
  }
  const foreign = countHits(titleWords, FOREIGN_MARKERS) * 3 + countHits(bodyWords, FOREIGN_MARKERS) > 0;
  return { category: best ?? fallback, territory: foreign ? "WORLD" : "IT" };
}

/**
 * Date of the reported fact, kept apart from the publication date. Only explicit
 * references are resolved; anything else stays null rather than being guessed.
 */
export function extractEventDate(text: string, publishedAt: Date): string | null {
  const folded = foldText(text);
  const day = 24 * 60 * 60 * 1000;
  if (/\b(oggi|stamattina|stamane|stasera)\b/.test(folded)) return publishedAt.toISOString();
  if (/\b(ieri|ieri sera)\b/.test(folded)) return new Date(publishedAt.getTime() - day).toISOString();
  return null;
}

export interface NormalizeOptions {
  now: Date;
  maxAgeHours: number;
}

/** Why a feed item is discarded before it reaches the database. */
export type DropReason = "undated" | "out_of_window" | "bad_url";

/** Returns null for items that cannot be verified: invalid URL, no date, stale or future-dated. */
export function normalizeItem(item: FeedItem, source: NewsSource, options: NormalizeOptions): Article | null {
  const result = classifyItem(item, source, options);
  return "article" in result ? result.article : null;
}

/** Like normalizeItem, but says why an item is dropped, so the funnel can count it. */
export function classifyItem(item: FeedItem, source: NewsSource, { now, maxAgeHours }: NormalizeOptions): { article: Article } | { drop: DropReason } {
  const published = parseFeedDate(item.publishedRaw);
  if (!published) return { drop: "undated" };
  const ageMs = now.getTime() - published.getTime();
  if (ageMs > maxAgeHours * 60 * 60 * 1000 || ageMs < -MAX_FUTURE_MS) return { drop: "out_of_window" };

  let canonicalUrl: string;
  try {
    canonicalUrl = canonicalizeUrl(item.url);
  } catch {
    return { drop: "bad_url" };
  }

  const text = `${item.title}. ${item.summary}`;
  const { category, territory } = classify(item.title, item.summary, source.defaultCategory ?? null);
  return { article: {
    id: randomUUID(),
    sourceId: source.id,
    groupKey: source.groupKey,
    reliability: source.reliability,
    official: source.official ?? false,
    url: item.url,
    canonicalUrl,
    title: item.title,
    summary: item.summary,
    author: item.author,
    publisher: source.publisher,
    publishedAt: published.toISOString(),
    eventAt: extractEventDate(text, published),
    fetchedAt: now.toISOString(),
    contentHash: sha256(foldText(text)),
    category,
    territory: source.territory ?? territory,
  } };
}

/** Removes exact repeats inside a batch: same URL, or same text from the same group. */
export function dedupeArticles(articles: Article[]): Article[] {
  const seen = new Set<string>();
  return articles.filter((article) => {
    const keys = [`u:${article.canonicalUrl}`, `h:${article.groupKey}:${article.contentHash}`];
    if (keys.some((key) => seen.has(key))) return false;
    keys.forEach((key) => seen.add(key));
    return true;
  });
}
