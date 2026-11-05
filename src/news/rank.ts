import { isLowValue } from "./normalize";
import type { Article, Cluster, RankedEvent } from "./types";

export interface RankOptions {
  now: Date;
  minIndependentSources: number;
  halfLifeHours: number;
  categoryWeights: Record<string, number>;
}

export const DEFAULT_RANK_OPTIONS: Omit<RankOptions, "now"> = {
  minIndependentSources: 2,
  halfLifeHours: 8,
  categoryWeights: { politica: 1, economia: 1, esteri: 0.9, salute: 0.9, ambiente: 0.9, tecnologia: 0.8, cronaca: 0.6, cultura: 0.5, sport: 0.4 },
};

const round = (value: number) => Math.round(value * 100) / 100;

function independentGroups(articles: Article[]): number {
  return new Set(articles.map((article) => article.groupKey)).size;
}

function mostCommon(values: Array<string | null>): string | null {
  const counts = new Map<string, number>();
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/**
 * Scores an event out of 100. Corroboration weighs most: views are not an input,
 * so a story cannot rank highly on popularity alone.
 */
export function rankCluster(cluster: Cluster, options: RankOptions): RankedEvent {
  const { articles } = cluster;
  const sorted = [...articles].sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt));
  const lead = [...articles].sort((a, b) => b.reliability - a.reliability || a.publishedAt.localeCompare(b.publishedAt))[0]!;
  const latest = sorted[sorted.length - 1]!;
  const groups = independentGroups(articles);
  const category = mostCommon(articles.map((article) => article.category));
  const territory = mostCommon(articles.map((article) => article.territory));
  const meanReliability = articles.reduce((sum, article) => sum + article.reliability, 0) / articles.length;
  const ageHours = Math.max(0, (options.now.getTime() - Date.parse(latest.publishedAt)) / 3_600_000);

  const independence = Math.min(35, (groups - 1) * 12);
  const reliability = meanReliability * 20;
  const recency = 20 * 0.5 ** (ageHours / options.halfLifeHours);
  const categoryScore = 20 * (category ? (options.categoryWeights[category] ?? 0.5) : 0.3);
  const territoryScore = territory === "IT" ? 5 : 3;
  const total = independence + reliability + recency + categoryScore + territoryScore;

  const hasOfficialSource = articles.some((article) => article.official);
  const lowValue = isLowValue(lead.title);
  const eligible = !lowValue && (groups >= options.minIndependentSources || hasOfficialSource);

  return {
    cluster,
    title: lead.title,
    summary: lead.summary,
    category,
    territory,
    firstSeenAt: sorted[0]!.publishedAt,
    lastSeenAt: latest.publishedAt,
    eventAt: sorted.find((article) => article.eventAt)?.eventAt ?? null,
    independentSources: groups,
    score: {
      independence: round(independence),
      reliability: round(reliability),
      recency: round(recency),
      category: round(categoryScore),
      territory: territoryScore,
      total: round(total),
    },
    eligible,
    ineligibleReason: eligible ? null : lowValue ? "low_value" : "single_source",
  };
}
