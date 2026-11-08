import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { FormatId } from "@/src/editorial/formats";
import type { Article, EventSnapshot, EventStatus, NewsSource, RankedEvent } from "@/src/news/types";
import type { UsageRecord } from "@/src/providers/types";
import type { CandidateBundle, EditorialStore, FetchStatus, ScriptVersionInput } from "./types";

interface SourceRow {
  id: string;
  slug: string;
  name: string;
  publisher: string;
  homepage_url: string;
  feed_url: string;
  group_key: string;
  reliability: number;
  default_category: string | null;
  etag: string | null;
  last_modified: string | null;
}

interface ArticleRow {
  id: string;
  source_id: string;
  url: string;
  canonical_url: string;
  title: string;
  summary: string;
  author: string | null;
  publisher: string;
  published_at: string;
  event_at: string | null;
  fetched_at: string;
  content_hash: string;
  category: string | null;
  territory: string | null;
  news_sources: { group_key: string; reliability: number } | null;
}

const ARTICLE_COLUMNS = "id, source_id, url, canonical_url, title, summary, author, publisher, published_at, event_at, fetched_at, content_hash, category, territory, news_sources(group_key, reliability)";

function toArticle(row: ArticleRow): Article {
  return {
    id: row.id,
    sourceId: row.source_id,
    groupKey: row.news_sources?.group_key ?? row.source_id,
    reliability: Number(row.news_sources?.reliability ?? 0.5),
    official: false,
    url: row.url,
    canonicalUrl: row.canonical_url,
    title: row.title,
    summary: row.summary,
    author: row.author,
    publisher: row.publisher,
    publishedAt: row.published_at,
    eventAt: row.event_at,
    fetchedAt: row.fetched_at,
    contentHash: row.content_hash,
    category: row.category,
    territory: row.territory,
  };
}

function unwrap<T>(result: { data: T; error: { code?: string } | null }, operation: string): T {
  // Database error text can quote row data, and job logs are public.
  if (result.error) throw new Error(`store_${operation}_failed:${result.error.code ?? "unknown"}`);
  return result.data;
}

export class SupabaseStore implements EditorialStore {
  private readonly client: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.client = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  }

  async listSources(): Promise<NewsSource[]> {
    const rows = unwrap(await this.client.from("news_sources").select("*").eq("enabled", true), "list_sources") as SourceRow[];
    return rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      publisher: row.publisher,
      homepageUrl: row.homepage_url,
      feedUrl: row.feed_url,
      groupKey: row.group_key,
      reliability: Number(row.reliability),
      defaultCategory: row.default_category,
      territory: null,
      etag: row.etag,
      lastModified: row.last_modified,
    }));
  }

  /** Publishes config/sources.json to the database; manual edits to tuning fields are overwritten. */
  async syncSources(sources: Array<Omit<NewsSource, "id">>): Promise<void> {
    const rows = sources.map((source) => ({
      slug: source.slug,
      name: source.name,
      publisher: source.publisher,
      homepage_url: source.homepageUrl,
      feed_url: source.feedUrl,
      group_key: source.groupKey,
      reliability: source.reliability,
      default_category: source.defaultCategory ?? null,
    }));
    unwrap(await this.client.from("news_sources").upsert(rows, { onConflict: "slug" }), "sync_sources");
  }

  async recordFetch(sourceId: string, status: FetchStatus): Promise<void> {
    const { data } = await this.client.from("news_sources").select("consecutive_failures").eq("id", sourceId).single();
    unwrap(
      await this.client
        .from("news_sources")
        .update({
          etag: status.etag,
          last_modified: status.lastModified,
          last_status: status.status,
          last_fetched_at: new Date().toISOString(),
          consecutive_failures: status.failed ? ((data?.consecutive_failures as number | undefined) ?? 0) + 1 : 0,
        })
        .eq("id", sourceId),
      "record_fetch",
    );
  }

  async insertArticles(articles: Article[]): Promise<Article[]> {
    if (articles.length === 0) return [];
    const rows = articles.map((article) => ({
      id: article.id,
      source_id: article.sourceId,
      url: article.url,
      canonical_url: article.canonicalUrl,
      title: article.title,
      summary: article.summary,
      author: article.author,
      publisher: article.publisher,
      published_at: article.publishedAt,
      event_at: article.eventAt,
      fetched_at: article.fetchedAt,
      content_hash: article.contentHash,
      category: article.category,
      territory: article.territory,
    }));
    const inserted = unwrap(
      await this.client.from("news_articles").upsert(rows, { onConflict: "canonical_url", ignoreDuplicates: true }).select("id"),
      "insert_articles",
    ) as Array<{ id: string }>;
    const ids = new Set(inserted.map((row) => row.id));
    return articles.filter((article) => ids.has(article.id));
  }

  async loadRecentEvents(sinceIso: string): Promise<EventSnapshot[]> {
    const rows = unwrap(
      await this.client
        .from("news_events")
        .select(`id, title, status, news_event_sources(news_articles(${ARTICLE_COLUMNS}))`)
        .gte("last_seen_at", sinceIso)
        .neq("status", "archived"),
      "load_events",
    ) as unknown as Array<{ id: string; title: string; status: EventStatus; news_event_sources: Array<{ news_articles: ArticleRow }> }>;
    return rows
      .map((row) => ({ id: row.id, title: row.title, status: row.status, articles: row.news_event_sources.map((link) => toArticle(link.news_articles)) }))
      .filter((event) => event.articles.length > 0);
  }

  async saveEvent(event: RankedEvent): Promise<string> {
    const row = {
      title: event.title,
      summary: event.summary,
      category: event.category,
      territory: event.territory,
      first_seen_at: event.firstSeenAt,
      last_seen_at: event.lastSeenAt,
      event_at: event.eventAt,
      independent_sources: event.independentSources,
      ineligible_reason: event.ineligibleReason,
      score: event.score.total,
      update_of_event_id: event.cluster.updateOfEventId,
    };
    const saved = event.cluster.eventId
      ? await this.client.from("news_events").update(row).eq("id", event.cluster.eventId).select("id").single()
      : await this.client.from("news_events").insert(row).select("id").single();
    const { id } = unwrap(saved, "save_event") as { id: string };

    const links = event.cluster.added.map(({ article, similarity }) => ({ event_id: id, article_id: article.id, similarity }));
    unwrap(await this.client.from("news_event_sources").upsert(links, { onConflict: "article_id", ignoreDuplicates: true }), "link_articles");
    return id;
  }

  async upsertCandidate(eventId: string, event: RankedEvent, format: FormatId): Promise<void> {
    unwrap(
      await this.client.from("editorial_candidates").upsert(
        { event_id: eventId, format, score: event.score.total, score_breakdown: event.score, is_update: event.cluster.updateOfEventId !== null },
        { onConflict: "event_id,format" },
      ),
      "upsert_candidate",
    );
  }

  async getCandidate(candidateId: string): Promise<CandidateBundle | null> {
    const row = unwrap(
      await this.client
        .from("editorial_candidates")
        .select(`id, status, format, event_id, scripts(id), news_events(news_event_sources(news_articles(${ARTICLE_COLUMNS})))`)
        .eq("id", candidateId)
        .maybeSingle(),
      "get_candidate",
    ) as unknown as {
      id: string; status: string; format: FormatId; event_id: string; scripts: unknown;
      news_events: { news_event_sources: Array<{ news_articles: ArticleRow }> };
    } | null;
    if (!row) return null;
    return {
      id: row.id,
      status: row.status,
      format: row.format,
      eventId: row.event_id,
      articles: row.news_events.news_event_sources.map((link) => toArticle(link.news_articles)),
      hasScript: Array.isArray(row.scripts) ? row.scripts.length > 0 : Boolean(row.scripts),
    };
  }

  async claimCandidate(candidateId: string): Promise<boolean> {
    return unwrap(await this.client.rpc("claim_candidate", { p_candidate_id: candidateId }), "claim_candidate") as boolean;
  }

  async saveScriptVersion(input: ScriptVersionInput): Promise<{ scriptId: string; version: number }> {
    const script = unwrap(
      await this.client
        .from("scripts")
        .upsert({ candidate_id: input.candidateId, format: input.format }, { onConflict: "candidate_id" })
        .select("id, current_version")
        .single(),
      "save_script",
    ) as { id: string; current_version: number };
    const version = script.current_version + 1;

    // unique (script_id, version) rejects a concurrent writer rather than overwriting.
    unwrap(
      await this.client.from("script_versions").insert({
        script_id: script.id,
        version,
        content: input.draft,
        narration: input.narration,
        word_count: input.wordCount,
        estimated_seconds: input.report.estimatedSeconds,
        youtube_metadata: input.youtubeMetadata,
        evidence: input.evidence,
        qc_verdict: input.report.verdict,
        qc_report: input.report,
        provider: input.provider,
        model: input.model,
      }),
      "save_version",
    );
    unwrap(
      await this.client
        .from("scripts")
        .update({ current_version: version, status: input.report.verdict === "blocked" ? "blocked" : "in_review" })
        .eq("id", script.id),
      "update_script",
    );
    unwrap(await this.client.from("editorial_candidates").update({ status: "scripted" }).eq("id", input.candidateId), "update_candidate");
    return { scriptId: script.id, version };
  }

  async record(usage: UsageRecord): Promise<void> {
    unwrap(
      await this.client.from("provider_usage").insert({
        provider: usage.provider,
        feature: usage.feature,
        model: usage.model,
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        characters: usage.characters,
        estimated_cost_usd: usage.estimatedCostUsd,
        latency_ms: usage.latencyMs,
        success: usage.success,
      }),
      "record_usage",
    );
  }

  async monthSpendUsd(): Promise<number> {
    return Number(unwrap(await this.client.rpc("provider_spend_usd"), "month_spend"));
  }
}
