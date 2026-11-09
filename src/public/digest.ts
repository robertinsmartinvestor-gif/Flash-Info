import { safeHttpsUrl } from "@/src/editorial/review";

/**
 * Server-side reads of the public digest. They use only the anonymous key, which
 * is public by design: what anon may read is decided by RLS and column grants in
 * the database (published items, public columns, minimal retraction notices).
 */

export interface DigestSource {
  publisher: string;
  url: string;
}

export interface DigestItem {
  id: string;
  slug: string;
  headline: string;
  summary: string;
  category: string | null;
  sourceLinks: DigestSource[];
  publishedAt: string;
  amendedAt: string | null;
  amendmentNote: string | null;
}

export interface Retraction {
  slug: string;
  publishedAt: string;
  retractedAt: string;
  note: string;
}

export type Loaded<T> = { ok: true; data: T } | { ok: false; data: T };

/** Seconds a rendered public page may be served from cache. Studio actions also revalidate at once. */
export const PUBLIC_REVALIDATE_SECONDS = 60;
export const DIGEST_CACHE_TAG = "digest";
const COLUMNS = "id,slug,headline,summary,category,source_links,published_at,amended_at,amendment_note";
export const SLUG_PATTERN = /^\d{4}-\d{2}-\d{2}-[a-z0-9-]{1,90}$/;

interface Row {
  id: string;
  slug: string;
  headline: string;
  summary: string;
  category: string | null;
  source_links: unknown;
  published_at: string;
  amended_at: string | null;
  amendment_note: string | null;
}

/** Keeps only well-formed https links: the column comes from the database, but the page never trusts it blindly. */
export function cleanSources(value: unknown): DigestSource[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const record = entry as { publisher?: unknown; url?: unknown };
    const url = typeof record.url === "string" ? safeHttpsUrl(record.url) : null;
    const publisher = typeof record.publisher === "string" ? record.publisher.trim() : "";
    return url && publisher ? [{ publisher, url }] : [];
  });
}

export function toItem(row: Row): DigestItem {
  return {
    id: row.id,
    slug: row.slug,
    headline: row.headline,
    summary: row.summary,
    category: row.category,
    sourceLinks: cleanSources(row.source_links),
    publishedAt: row.published_at,
    amendedAt: row.amended_at,
    amendmentNote: row.amendment_note,
  };
}

function config(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
}

async function rest<T>(path: string, init: RequestInit = {}): Promise<T | null> {
  const target = config();
  if (!target) return null;
  try {
    const response = await fetch(`${target.url}/rest/v1/${path}`, {
      ...init,
      headers: { apikey: target.key, authorization: `Bearer ${target.key}`, "content-type": "application/json", ...init.headers },
      next: { revalidate: PUBLIC_REVALIDATE_SECONDS, tags: [DIGEST_CACHE_TAG] },
    });
    if (!response.ok) {
      console.error(`digest_read_failed:${response.status}`);
      return null;
    }
    return (await response.json()) as T;
  } catch {
    console.error("digest_read_failed:network");
    return null;
  }
}

export async function listPublished(limit = 60): Promise<Loaded<DigestItem[]>> {
  const rows = await rest<Row[]>(`digest_items?select=${COLUMNS}&order=published_at.desc&limit=${Math.min(Math.max(limit, 1), 500)}`);
  return rows ? { ok: true, data: rows.map(toItem) } : { ok: false, data: [] };
}

export async function getPublished(slug: string): Promise<Loaded<DigestItem | null>> {
  if (!SLUG_PATTERN.test(slug)) return { ok: true, data: null };
  const rows = await rest<Row[]>(`digest_items?select=${COLUMNS}&slug=eq.${encodeURIComponent(slug)}&limit=1`);
  if (!rows) return { ok: false, data: null };
  return { ok: true, data: rows[0] ? toItem(rows[0]) : null };
}

interface RetractionRow { slug: string; published_at: string; retracted_at: string; retraction_note: string }

export async function listRetractions(slug?: string): Promise<Loaded<Retraction[]>> {
  if (slug !== undefined && !SLUG_PATTERN.test(slug)) return { ok: true, data: [] };
  const rows = await rest<RetractionRow[]>("rpc/digest_retractions", {
    method: "POST",
    body: JSON.stringify({ p_slug: slug ?? null }),
  });
  if (!rows) return { ok: false, data: [] };
  return { ok: true, data: rows.map((row) => ({ slug: row.slug, publishedAt: row.published_at, retractedAt: row.retracted_at, note: row.retraction_note })) };
}

const ROME_DAY = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", weekday: "long", day: "numeric", month: "long", year: "numeric" });
const ROME_KEY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" });
const ROME_TIME = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit" });
const ROME_DATETIME = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

export const formatRomeDay = (iso: string) => ROME_DAY.format(new Date(iso));
export const formatRomeTime = (iso: string) => ROME_TIME.format(new Date(iso));
export const formatRomeDateTime = (iso: string) => ROME_DATETIME.format(new Date(iso));

/** Groups items by calendar day in Rome, newest day first, keeping the given order inside a day. */
export function groupByRomeDay(items: DigestItem[]): Array<{ key: string; label: string; items: DigestItem[] }> {
  const groups = new Map<string, { key: string; label: string; items: DigestItem[] }>();
  for (const item of items) {
    const key = ROME_KEY.format(new Date(item.publishedAt));
    const group = groups.get(key) ?? { key, label: formatRomeDay(item.publishedAt), items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.key.localeCompare(a.key));
}

/** schema.org NewsArticle for one item. Citations are the source links; no image, no author invented. */
export function newsArticleJsonLd(item: DigestItem, origin: string, publisherName: string | null): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: item.headline,
    description: item.summary,
    datePublished: item.publishedAt,
    dateModified: item.amendedAt ?? item.publishedAt,
    mainEntityOfPage: `${origin}/notizie/${item.slug}`,
    inLanguage: "it-IT",
    ...(item.category ? { articleSection: item.category } : {}),
    publisher: { "@type": "Organization", name: publisherName ?? "OgniOra", url: origin },
    isBasedOn: item.sourceLinks.map((source) => source.url),
    citation: item.sourceLinks.map((source) => ({ "@type": "CreativeWork", url: source.url, publisher: { "@type": "Organization", name: source.publisher } })),
  };
}

/** JSON for a <script type="application/ld+json">: escapes "<" so text can never close the tag. */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
