/** The editorial funnel of the last 24 hours, as read from editorial_funnel_24h. */
export interface Funnel {
  ingest_runs: number;
  feed_items: number;
  dropped_undated: number;
  dropped_out_of_window: number;
  dropped_bad_url: number;
  dropped_duplicate: number;
  new_articles: number;
  events_seen: number;
  single_source: number;
  low_value: number;
  unclassified: number;
  eligible_unselected: number;
  scripts_blocked: number;
  scripts_held: number;
  digest_published: number;
  classified_since: string | null;
  drops_since: string | null;
}

export const FUNNEL_WINDOW_MS = 24 * 3600_000;

/**
 * Whether a counter covers the whole 24-hour window. Counters introduced by the
 * public-digest migration start at its application time and are partial before.
 */
export function coverage(since: string | null, now = Date.now()): { complete: boolean; since: string | null } {
  if (!since) return { complete: false, since: null };
  return { complete: Date.parse(since) <= now - FUNNEL_WINDOW_MS, since };
}

/** Postgres bigint counts may arrive as strings: normalize once. */
export function toFunnel(row: Record<string, unknown> | null): Funnel | null {
  if (!row) return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = key.endsWith("_since") ? (value as string | null) : Number(value ?? 0);
  }
  return out as unknown as Funnel;
}
