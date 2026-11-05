import { fetchFeed } from "@/src/news/feed";
import { clusterArticles, DEFAULT_CLUSTER_OPTIONS } from "@/src/news/cluster";
import { dedupeArticles, normalizeItem } from "@/src/news/normalize";
import { DEFAULT_RANK_OPTIONS, rankCluster } from "@/src/news/rank";
import type { Article, NewsSource, RankedEvent } from "@/src/news/types";
import type { EditorialStore } from "@/src/store/types";

const MAX_ARTICLE_AGE_HOURS = 72;
const CONCURRENCY = 4;
const EVENT_LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000;

export interface IngestReport {
  sources: Array<{ slug: string; status: string; items: number; kept: number }>;
  newArticles: number;
  ranked: RankedEvent[];
  candidates: number;
}

async function ingestSource(source: NewsSource, store: EditorialStore, now: Date, fetchImpl: typeof fetch) {
  try {
    const result = await fetchFeed(source, fetchImpl);
    await store.recordFetch(source.id, { etag: result.etag, lastModified: result.lastModified, status: result.status, failed: false });
    const articles = result.items.flatMap((item) => normalizeItem(item, source, { now, maxAgeHours: MAX_ARTICLE_AGE_HOURS }) ?? []);
    return { report: { slug: source.slug, status: result.status, items: result.items.length, kept: articles.length }, articles };
  } catch (error) {
    // One broken feed must not stop the others.
    const status = error instanceof Error ? error.message.slice(0, 60) : "error";
    await store.recordFetch(source.id, { etag: source.etag ?? null, lastModified: source.lastModified ?? null, status, failed: true });
    return { report: { slug: source.slug, status, items: 0, kept: 0 }, articles: [] as Article[] };
  }
}

export async function runIngest(store: EditorialStore, now = new Date(), fetchImpl: typeof fetch = fetch): Promise<IngestReport> {
  const sources = await store.listSources();
  const reports: IngestReport["sources"] = [];
  const collected: Article[] = [];

  for (let index = 0; index < sources.length; index += CONCURRENCY) {
    const batch = sources.slice(index, index + CONCURRENCY);
    for (const { report, articles } of await Promise.all(batch.map((source) => ingestSource(source, store, now, fetchImpl)))) {
      reports.push(report);
      collected.push(...articles);
    }
  }

  const fresh = await store.insertArticles(dedupeArticles(collected));
  const existing = await store.loadRecentEvents(new Date(now.getTime() - EVENT_LOOKBACK_MS).toISOString());
  const clusters = clusterArticles(fresh, existing, DEFAULT_CLUSTER_OPTIONS);

  const ranked = clusters
    .map((cluster) => rankCluster(cluster, { ...DEFAULT_RANK_OPTIONS, now }))
    .sort((a, b) => b.score.total - a.score.total);

  let candidates = 0;
  for (const event of ranked) {
    const eventId = await store.saveEvent(event);
    if (event.eligible) {
      await store.upsertCandidate(eventId, event, "flash");
      candidates += 1;
    }
  }

  return { sources: reports, newArticles: fresh.length, ranked, candidates };
}
