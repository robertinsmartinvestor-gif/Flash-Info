import { XMLParser } from "fast-xml-parser";
import { toPlainText } from "@/src/core/text";
import type { FeedItem, NewsSource } from "./types";

const MAX_FEED_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 2;
const TIMEOUT_MS = 15_000;
const USER_AGENT = "OgniOraBot/2.0 (editorial news monitoring)";

type XmlNode = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: false,
  htmlEntities: false,
});

function asArray(value: unknown): XmlNode[] {
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? value : [value]) as XmlNode[];
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return textOf(value[0]);
  if (value && typeof value === "object") return textOf((value as XmlNode)["#text"]);
  return "";
}

function atomLink(entry: XmlNode): string {
  const links = asArray(entry.link);
  const alternate = links.find((link) => !link["@_rel"] || link["@_rel"] === "alternate");
  return textOf((alternate ?? links[0])?.["@_href"]);
}

function pickDate(item: XmlNode): string | null {
  const value = textOf(item.pubDate) || textOf(item["dc:date"]) || textOf(item.published) || textOf(item.updated);
  return value || null;
}

function pickAuthor(item: XmlNode): string | null {
  const author = textOf(item["dc:creator"]) || textOf(item.author) || textOf((item.author as XmlNode | undefined)?.name);
  return author ? toPlainText(author, 120) : null;
}

/** Removes wire-service markers such as "++ ... ++" and the "LIVE" suffix. */
function cleanTitle(raw: string): string {
  return toPlainText(raw, 300)
    .replace(/^\+\+\s*|\s*\+\+$/g, "")
    .replace(/[.:\s-]*\bLIVE$/, "")
    .trim();
}

export function parseFeed(xml: string): FeedItem[] {
  const doc = parser.parse(xml) as XmlNode;
  const rss = doc.rss as XmlNode | undefined;
  const rdf = doc["rdf:RDF"] as XmlNode | undefined;
  const atom = doc.feed as XmlNode | undefined;

  const rssItems = asArray((rss?.channel as XmlNode | undefined)?.item ?? rdf?.item);
  const items: FeedItem[] = rssItems.map((item) => ({
    title: cleanTitle(textOf(item.title)),
    url: (textOf(item.link) || textOf(item.guid)).trim(),
    summary: toPlainText(textOf(item.description) || textOf(item["content:encoded"])),
    author: pickAuthor(item),
    publishedRaw: pickDate(item),
  }));

  for (const entry of asArray(atom?.entry)) {
    items.push({
      title: cleanTitle(textOf(entry.title)),
      url: atomLink(entry),
      summary: toPlainText(textOf(entry.summary) || textOf(entry.content)),
      author: pickAuthor(entry),
      publishedRaw: pickDate(entry),
    });
  }

  return items.filter((item) => item.title && item.url.startsWith("https://"));
}

function sameSite(a: URL, b: URL): boolean {
  const site = (url: URL) => url.hostname.split(".").slice(-2).join(".");
  return site(a) === site(b);
}

async function readCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_FEED_BYTES) {
      await reader.cancel();
      throw new Error("feed_too_large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export interface FetchResult {
  status: "ok" | "not_modified";
  items: FeedItem[];
  etag: string | null;
  lastModified: string | null;
}

/**
 * Downloads one configured feed. URLs come only from our source list; https is
 * mandatory, redirects may not leave the site, and the size and time are capped.
 */
export async function fetchFeed(source: NewsSource, fetchImpl: typeof fetch = fetch): Promise<FetchResult> {
  const origin = new URL(source.feedUrl);
  if (origin.protocol !== "https:") throw new Error("feed_not_https");

  let url = origin;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const headers: Record<string, string> = { "user-agent": USER_AGENT, accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" };
    if (source.etag) headers["if-none-match"] = source.etag;
    if (source.lastModified) headers["if-modified-since"] = source.lastModified;

    const response = await fetchImpl(url, { headers, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });

    if (response.status >= 300 && response.status < 400 && response.status !== 304) {
      const next = new URL(response.headers.get("location") ?? "", url);
      if (next.protocol !== "https:" || !sameSite(origin, next)) throw new Error("feed_redirect_blocked");
      url = next;
      continue;
    }
    if (response.status === 304) return { status: "not_modified", items: [], etag: source.etag ?? null, lastModified: source.lastModified ?? null };
    if (!response.ok) throw new Error(`feed_http_${response.status}`);

    return {
      status: "ok",
      items: parseFeed(await readCapped(response)),
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
    };
  }
  throw new Error("feed_too_many_redirects");
}
