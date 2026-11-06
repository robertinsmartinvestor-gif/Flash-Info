import { describe, expect, it, vi } from "vitest";
import { fetchFeed, parseFeed } from "@/src/news/feed";
import type { NewsSource } from "@/src/news/types";

const source: NewsSource = {
  id: "s", slug: "s1", name: "S", publisher: "S", homepageUrl: "https://example.it", feedUrl: "https://example.it/rss", groupKey: "s", reliability: 0.8,
};

const rss = (items: string) => `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>${items}</channel></rss>`;

describe("parseFeed", () => {
  it("reads RSS with CDATA and escaped HTML", () => {
    const [item] = parseFeed(rss(`<item><title><![CDATA[Titolo]]></title><link>https://a.it/1</link><description>&lt;p&gt;Testo &lt;b&gt;forte&lt;/b&gt;&lt;/p&gt;</description><pubDate>Thu, 05 Nov 2026 21:00:00 GMT</pubDate></item>`));
    expect(item).toMatchObject({ title: "Titolo", url: "https://a.it/1", summary: "Testo forte", publishedRaw: "Thu, 05 Nov 2026 21:00:00 GMT" });
  });

  it("uses guid when link is missing, as Sky TG24 does", () => {
    const items = parseFeed(rss(`<item><title>T</title><guid>https://tg24.sky.it/a</guid></item>`));
    expect(items[0]?.url).toBe("https://tg24.sky.it/a");
  });

  it("reads Atom", () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>A</title><link rel="alternate" href="https://a.it/2"/><summary>S</summary><updated>2026-11-05T10:00:00Z</updated></entry></feed>`;
    expect(parseFeed(xml)[0]).toMatchObject({ title: "A", url: "https://a.it/2", publishedRaw: "2026-11-05T10:00:00Z" });
  });

  it("strips wire markers from titles", () => {
    const items = parseFeed(rss(`<item><title>++ Trump, accordo vicino ++</title><link>https://a.it/3</link></item><item><title>Caos aerei. LIVE</title><link>https://a.it/4</link></item>`));
    expect(items.map((item) => item.title)).toEqual(["Trump, accordo vicino", "Caos aerei"]);
  });

  it("removes scripts, tags and invisible characters from untrusted text", () => {
    const [item] = parseFeed(rss(`<item><title>T</title><link>https://a.it/5</link><description><![CDATA[<script>alert(1)</script>Testo<img src=x onerror=y>‮fine]]></description></item>`));
    expect(item?.summary).toBe("Testo fine");
  });

  it("drops items whose link is not https", () => {
    expect(parseFeed(rss(`<item><title>T</title><link>javascript:alert(1)</link></item><item><title>T</title><link>http://a.it</link></item>`))).toEqual([]);
  });
});

describe("fetchFeed", () => {
  const ok = (body: string, headers: Record<string, string> = {}) => new Response(body, { status: 200, headers });

  it("refuses non-https sources", async () => {
    await expect(fetchFeed({ ...source, feedUrl: "http://example.it/rss" })).rejects.toThrow("feed_not_https");
  });

  it("does not follow a redirect to another site", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://169.254.169.254/latest" } }));
    await expect(fetchFeed(source, fetcher as typeof fetch)).rejects.toThrow("feed_redirect_blocked");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("follows a redirect inside the site", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: "https://www.example.it/rss2" } }))
      .mockResolvedValueOnce(ok(rss("")));
    await expect(fetchFeed(source, fetcher as unknown as typeof fetch)).resolves.toMatchObject({ status: "ok" });
  });

  it("uses conditional requests and handles 304", async () => {
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>)["if-none-match"]).toBe('"v1"');
      return new Response(null, { status: 304 });
    });
    const result = await fetchFeed({ ...source, etag: '"v1"' }, fetcher as typeof fetch);
    expect(result).toMatchObject({ status: "not_modified", items: [], etag: '"v1"' });
  });

  it("rejects oversized feeds", async () => {
    const fetcher = vi.fn(async () => ok("x".repeat(6 * 1024 * 1024)));
    await expect(fetchFeed(source, fetcher as typeof fetch)).rejects.toThrow("feed_too_large");
  });

  it("reports HTTP failures", async () => {
    await expect(fetchFeed(source, (async () => new Response("", { status: 403 })) as typeof fetch)).rejects.toThrow("feed_http_403");
  });
});
