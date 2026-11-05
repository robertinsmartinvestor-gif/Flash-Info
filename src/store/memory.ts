import { randomUUID } from "node:crypto";
import type { FormatId } from "@/src/editorial/formats";
import type { Article, EventSnapshot, NewsSource, RankedEvent } from "@/src/news/types";
import type { UsageRecord } from "@/src/providers/types";
import type { CandidateBundle, EditorialStore, FetchStatus, ScriptVersionInput } from "./types";

/** In-memory store for tests and `--dry-run`: nothing leaves the process. */
export class MemoryStore implements EditorialStore {
  readonly articles = new Map<string, Article>();
  readonly events = new Map<string, EventSnapshot>();
  readonly candidates = new Map<string, CandidateBundle & { score: number }>();
  readonly versions: ScriptVersionInput[] = [];
  readonly usage: UsageRecord[] = [];
  readonly fetches = new Map<string, FetchStatus>();

  constructor(private readonly sources: NewsSource[] = []) {}

  async listSources() {
    return this.sources;
  }

  async recordFetch(sourceId: string, status: FetchStatus) {
    this.fetches.set(sourceId, status);
  }

  async insertArticles(articles: Article[]) {
    const inserted = articles.filter((article) => !this.articles.has(article.canonicalUrl));
    inserted.forEach((article) => this.articles.set(article.canonicalUrl, article));
    return inserted;
  }

  async loadRecentEvents(sinceIso: string) {
    return [...this.events.values()].filter((event) => event.articles.some((article) => article.publishedAt >= sinceIso));
  }

  async saveEvent(event: RankedEvent) {
    const id = event.cluster.eventId ?? randomUUID();
    const current = this.events.get(id);
    this.events.set(id, { id, title: event.title, status: current?.status ?? "open", articles: event.cluster.articles });
    return id;
  }

  async upsertCandidate(eventId: string, event: RankedEvent, format: FormatId) {
    const existing = [...this.candidates.values()].find((candidate) => candidate.eventId === eventId && candidate.format === format);
    if (existing) {
      existing.score = event.score.total;
      existing.articles = event.cluster.articles;
      return;
    }
    const id = randomUUID();
    this.candidates.set(id, { id, status: "proposed", format, eventId, articles: event.cluster.articles, hasScript: false, score: event.score.total });
  }

  async getCandidate(candidateId: string) {
    return this.candidates.get(candidateId) ?? null;
  }

  async claimCandidate(candidateId: string) {
    const candidate = this.candidates.get(candidateId);
    if (candidate?.status !== "selected") return false;
    candidate.status = "composing";
    return true;
  }

  async saveScriptVersion(input: ScriptVersionInput) {
    this.versions.push(input);
    const candidate = this.candidates.get(input.candidateId);
    if (candidate) candidate.hasScript = true;
    return { scriptId: input.candidateId, version: this.versions.filter((version) => version.candidateId === input.candidateId).length };
  }

  async record(usage: UsageRecord) {
    this.usage.push(usage);
  }

  async monthSpendUsd() {
    return this.usage.reduce((sum, usage) => sum + usage.estimatedCostUsd, 0);
  }
}
