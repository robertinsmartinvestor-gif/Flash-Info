import { tokenize } from "@/src/core/text";
import type { Article, Cluster, EventSnapshot } from "./types";

type Vector = Map<string, number>;

export interface ClusterOptions {
  /** Minimum cosine similarity to join a cluster. */
  threshold: number;
  /** Rare terms two stories must share, to avoid matches on generic vocabulary. */
  minSharedTerms: number;
  /** Maximum distance from the newest article in the cluster. */
  windowHours: number;
  /** Optional provider embeddings by article id; averaged with the lexical score when present. */
  embeddings?: Map<string, number[]>;
}

export const DEFAULT_CLUSTER_OPTIONS: ClusterOptions = { threshold: 0.3, minSharedTerms: 2, windowHours: 48 };

const TITLE_WEIGHT = 3;

function documentTerms(article: Article): Map<string, number> {
  const terms = new Map<string, number>();
  for (const token of tokenize(article.title)) terms.set(token, (terms.get(token) ?? 0) + TITLE_WEIGHT);
  for (const token of tokenize(article.summary)) terms.set(token, (terms.get(token) ?? 0) + 1);
  return terms;
}

function buildIdf(documents: Array<Map<string, number>>): Map<string, number> {
  const frequency = new Map<string, number>();
  for (const terms of documents) {
    for (const term of terms.keys()) frequency.set(term, (frequency.get(term) ?? 0) + 1);
  }
  const idf = new Map<string, number>();
  for (const [term, count] of frequency) idf.set(term, Math.log((1 + documents.length) / (1 + count)) + 1);
  return idf;
}

/**
 * Terms specific enough to identify a story. Based on document frequency: most
 * words in short titles appear once, so a median of IDF would keep only words no
 * two articles share. The floor matters for small incremental runs, where one
 * big story can fill the batch and its own words would otherwise look generic.
 */
function rareTerms(documents: Array<Map<string, number>>): Set<string> {
  const limit = Math.max(8, Math.ceil(documents.length * 0.06));
  const frequency = new Map<string, number>();
  for (const terms of documents) {
    for (const term of terms.keys()) frequency.set(term, (frequency.get(term) ?? 0) + 1);
  }
  return new Set([...frequency].filter(([, count]) => count <= limit).map(([term]) => term));
}

function normalize(vector: Vector): Vector {
  const norm = Math.sqrt([...vector.values()].reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) return vector;
  return new Map([...vector].map(([term, value]) => [term, value / norm]));
}

function cosine(a: Vector, b: Vector): number {
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  let sum = 0;
  for (const [term, value] of small) sum += value * (large.get(term) ?? 0);
  return sum;
}

function embeddingCosine(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  a.forEach((value, index) => {
    const other = b[index] ?? 0;
    dot += value * other;
    normA += value * value;
    normB += other * other;
  });
  return normA && normB ? dot / Math.sqrt(normA * normB) : 0;
}

interface WorkingCluster extends Cluster {
  centroid: Vector;
  lastAt: number;
  covered: boolean;
}

function addToCentroid(centroid: Vector, vector: Vector): Vector {
  const merged = new Map(centroid);
  for (const [term, value] of vector) merged.set(term, (merged.get(term) ?? 0) + value);
  return normalize(merged);
}

function sharedRareTerms(a: Vector, b: Vector, rare: Set<string>): number {
  let shared = 0;
  for (const term of a.keys()) {
    if (b.has(term) && rare.has(term)) shared += 1;
  }
  return shared;
}

/**
 * Single-pass clustering, oldest first. Stored events act as seeds, so a new
 * article joins its running story. A match on an already covered event starts
 * a new cluster marked as an update of it instead of reopening it.
 */
export function clusterArticles(
  incoming: Article[],
  existing: EventSnapshot[],
  options: ClusterOptions = DEFAULT_CLUSTER_OPTIONS,
): Cluster[] {
  const seeds = existing.flatMap((event) => event.articles);
  const terms = new Map<string, Map<string, number>>();
  for (const article of [...seeds, ...incoming]) terms.set(article.id, documentTerms(article));

  const documents = [...terms.values()];
  const idf = buildIdf(documents);
  const rare = rareTerms(documents);
  const vectorOf = (article: Article): Vector =>
    normalize(new Map([...terms.get(article.id)!].map(([term, tf]) => [term, tf * (idf.get(term) ?? 1)])));

  const windowMs = options.windowHours * 60 * 60 * 1000;
  const clusters: WorkingCluster[] = existing.map((event) => ({
    eventId: event.id,
    updateOfEventId: null,
    articles: [...event.articles],
    added: [],
    centroid: event.articles.reduce((centroid, article) => addToCentroid(centroid, vectorOf(article)), new Map() as Vector),
    lastAt: Math.max(...event.articles.map((article) => Date.parse(article.publishedAt))),
    covered: event.status !== "open",
  }));

  const ordered = [...incoming].sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt));
  for (const article of ordered) {
    const vector = vectorOf(article);
    const at = Date.parse(article.publishedAt);
    let best: WorkingCluster | null = null;
    let bestScore = 0;

    for (const cluster of clusters) {
      if (Math.abs(at - cluster.lastAt) > windowMs) continue;
      if (sharedRareTerms(vector, cluster.centroid, rare) < options.minSharedTerms) continue;
      let score = cosine(vector, cluster.centroid);
      const embedding = options.embeddings?.get(article.id);
      const other = options.embeddings?.get(cluster.articles[0]?.id ?? "");
      if (embedding && other) score = (score + embeddingCosine(embedding, other)) / 2;
      if (score > bestScore) {
        best = cluster;
        bestScore = score;
      }
    }

    if (best && bestScore >= options.threshold && !best.covered) {
      best.articles.push(article);
      best.added.push({ article, similarity: Math.min(1, bestScore) });
      best.centroid = addToCentroid(best.centroid, vector);
      best.lastAt = Math.max(best.lastAt, at);
      continue;
    }

    clusters.push({
      eventId: null,
      updateOfEventId: best && bestScore >= options.threshold ? best.eventId : null,
      articles: [article],
      added: [{ article, similarity: 1 }],
      centroid: vector,
      lastAt: at,
      covered: false,
    });
  }

  return clusters
    .filter((cluster) => cluster.added.length > 0)
    .map(({ eventId, updateOfEventId, articles, added }) => ({ eventId, updateOfEventId, articles, added }));
}
