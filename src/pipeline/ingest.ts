import { fetchFeed } from "@/src/news/feed";
import { clusterArticles, DEFAULT_CLUSTER_OPTIONS } from "@/src/news/cluster";
import { classifyItem, dedupeArticles, type DropReason } from "@/src/news/normalize";
import { DEFAULT_RANK_OPTIONS, rankCluster } from "@/src/news/rank";
import type { Article, NewsSource, RankedEvent } from "@/src/news/types";
import type { EditorialStore, IngestRun } from "@/src/store/types";

const MAX_ARTICLE_AGE_HOURS = 72;
const CONCURRENCY = 4;
const EVENT_LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000;

type Drops = Record<DropReason, number>;

export interface IngestReport {
  sources: Array<{ slug: string; status: string; items: number; kept: number }>;
  newArticles: number;
  ranked: RankedEvent[];
  candidates: number;
  /** The counters stored in ingest_runs: what was seen, dropped and kept. */
  run: IngestRun;
}

const noDrops = (): Drops => ({ undated: 0, out_of_window: 0, bad_url: 0 });

async function ingestSource(source: NewsSource, store: EditorialStore, now: Date, fetchImpl: typeof fetch) {
  const drops = noDrops();
  try {
    const result = await fetchFeed(source, fetchImpl);
    await store.recordFetch(source.id, { etag: result.etag, lastModified: result.lastModified, status: result.status, failed: false });
    const articles: Article[] = [];
    for (const item of result.items) {
      const outcome = classifyItem(item, source, { now, maxAgeHours: MAX_ARTICLE_AGE_HOURS });
      if ("article" in outcome) articles.push(outcome.article);
      else drops[outcome.drop] += 1;
    }
    return { report: { slug: source.slug, status: result.status, items: result.items.length, kept: articles.length }, articles, drops, failed: false };
  } catch (error) {
    // One broken feed must not stop the others.
    const status = error instanceof Error ? error.message.slice(0, 60) : "error";
    await store.recordFetch(source.id, { etag: source.etag ?? null, lastModified: source.lastModified ?? null, status, failed: true });
    return { report: { slug: source.slug, status, items: 0, kept: 0 }, articles: [] as Article[], drops, failed: true };
  }
}

export async function runIngest(store: EditorialStore, now = new Date(), fetchImpl: typeof fetch = fetch): Promise<IngestReport> {
  const sources = await store.listSources();
  const reports: IngestReport["sources"] = [];
  const collected: Article[] = [];
  const drops = noDrops();
  let failed = 0;

  for (let index = 0; index < sources.length; index += CONCURRENCY) {
    const batch = sources.slice(index, index + CONCURRENCY);
    for (const outcome of await Promise.all(batch.map((source) => ingestSource(source, store, now, fetchImpl)))) {
      reports.push(outcome.report);
      collected.push(...outcome.articles);
      for (const reason of Object.keys(drops) as DropReason[]) drops[reason] += outcome.drops[reason];
      if (outcome.failed) failed += 1;
    }
  }

  const unique = dedupeArticles(collected);
  const fresh = await store.insertArticles(unique);
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

  const run: IngestRun = {
    sourcesTotal: sources.length,
    sourcesFailed: failed,
    itemsSeen: reports.reduce((sum, report) => sum + report.items, 0),
    droppedUndated: drops.undated,
    droppedOutOfWindow: drops.out_of_window,
    droppedBadUrl: drops.bad_url,
    droppedDuplicate: collected.length - unique.length,
    alreadyStored: unique.length - fresh.length,
    newArticles: fresh.length,
    eventsSaved: ranked.length,
    candidates,
  };
  await store.recordIngestRun(run);

  return { sources: reports, newArticles: fresh.length, ranked, candidates, run };
}
