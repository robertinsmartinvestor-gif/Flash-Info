export interface NewsSource {
  id: string;
  slug: string;
  name: string;
  publisher: string;
  homepageUrl: string;
  feedUrl: string;
  groupKey: string;
  reliability: number;
  defaultCategory?: string | null;
  territory?: string | null;
  official?: boolean;
  etag?: string | null;
  lastModified?: string | null;
}

export interface FeedItem {
  title: string;
  url: string;
  summary: string;
  author: string | null;
  publishedRaw: string | null;
}

export interface Article {
  id: string;
  sourceId: string;
  groupKey: string;
  reliability: number;
  official: boolean;
  url: string;
  canonicalUrl: string;
  title: string;
  summary: string;
  author: string | null;
  publisher: string;
  publishedAt: string;
  eventAt: string | null;
  fetchedAt: string;
  contentHash: string;
  category: string | null;
  territory: string | null;
}

export type EventStatus = "open" | "covered" | "archived";

/** An event already stored, used as a seed when clustering new articles. */
export interface EventSnapshot {
  id: string;
  title: string;
  status: EventStatus;
  articles: Article[];
}

export interface Cluster {
  eventId: string | null;
  updateOfEventId: string | null;
  articles: Article[];
  added: Array<{ article: Article; similarity: number }>;
}

export interface ScoreBreakdown {
  independence: number;
  reliability: number;
  recency: number;
  category: number;
  territory: number;
  total: number;
}

export interface RankedEvent {
  cluster: Cluster;
  title: string;
  summary: string;
  category: string | null;
  territory: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  eventAt: string | null;
  independentSources: number;
  score: ScoreBreakdown;
  eligible: boolean;
  ineligibleReason: string | null;
}
