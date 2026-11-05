import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { rankCluster, DEFAULT_RANK_OPTIONS } from "@/src/news/rank";
import { SupabaseStore } from "@/src/store/supabase";
import { article, NOW, validDraft } from "../helpers/fixtures";

/**
 * Runs SupabaseStore against a real PostgREST and Postgres, which the unit tests
 * do not reach. Point it at a disposable stack only: it writes rows.
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=... npm run test:integration
 */
const url = process.env.SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const anonKey = process.env.SUPABASE_ANON_KEY ?? "";

describe.skipIf(!url)("SupabaseStore", () => {
  const store = new SupabaseStore(url, serviceKey);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const slug = `t-${randomUUID().slice(0, 8)}`;
  const source = {
    slug, name: "Test", publisher: "Test", homepageUrl: "https://t.it", feedUrl: `https://t.it/${slug}`, groupKey: "ansa", reliability: 0.9, defaultCategory: "politica",
  };

  async function sourceId(): Promise<string> {
    const found = (await store.listSources()).find((item) => item.slug === slug);
    if (!found) throw new Error("source missing");
    return found.id;
  }

  async function seedEvent() {
    const id = await sourceId();
    const items = [
      article({ sourceId: id, groupKey: "ansa", title: "Primo titolo", canonicalUrl: `https://t.it/${randomUUID()}` }),
      article({ sourceId: id, groupKey: "rai", title: "Secondo titolo", canonicalUrl: `https://t.it/${randomUUID()}` }),
    ];
    await store.insertArticles(items);
    const ranked = rankCluster(
      { eventId: null, updateOfEventId: null, articles: items, added: items.map((item) => ({ article: item, similarity: 0.8 })) },
      { ...DEFAULT_RANK_OPTIONS, now: NOW },
    );
    const eventId = await store.saveEvent(ranked);
    await store.upsertCandidate(eventId, ranked, "flash");
    const { data } = await admin.from("editorial_candidates").select("id").eq("event_id", eventId).single();
    return { eventId, candidateId: (data as { id: string }).id, items, ranked };
  }

  it("syncs sources idempotently", async () => {
    await store.syncSources([source]);
    await store.syncSources([{ ...source, reliability: 0.8 }]);
    expect((await store.listSources()).find((item) => item.slug === slug)?.reliability).toBe(0.8);
  });

  it("records fetch state and counts failures", async () => {
    const id = await sourceId();
    await store.recordFetch(id, { etag: "e", lastModified: null, status: "http_500", failed: true });
    await store.recordFetch(id, { etag: "e", lastModified: null, status: "http_500", failed: true });
    const { data } = await admin.from("news_sources").select("consecutive_failures, etag").eq("id", id).single();
    expect(data).toEqual({ consecutive_failures: 2, etag: "e" });
  });

  it("inserts only new articles", async () => {
    const item = article({ sourceId: await sourceId(), canonicalUrl: `https://t.it/${randomUUID()}` });
    expect(await store.insertArticles([item])).toHaveLength(1);
    const duplicate = { ...item, id: randomUUID() };
    expect(await store.insertArticles([duplicate])).toEqual([]);
  });

  it("saves events and returns them with their articles", async () => {
    const { eventId } = await seedEvent();
    const events = await store.loadRecentEvents("2026-01-01T00:00:00Z");
    const found = events.find((event) => event.id === eventId);
    expect(found?.articles).toHaveLength(2);
    expect(found?.articles[0]?.groupKey).toBeTruthy();
  });

  it("keeps candidates unique per event and format", async () => {
    const { eventId, ranked } = await seedEvent();
    await store.upsertCandidate(eventId, ranked, "flash");
    const { data } = await admin.from("editorial_candidates").select("id").eq("event_id", eventId);
    expect(data).toHaveLength(1);
  });

  it("stores script versions in sequence and exposes them on the candidate", async () => {
    const { candidateId, items } = await seedEvent();
    const input = {
      candidateId, format: "flash" as const, draft: validDraft(), narration: "testo", wordCount: 1,
      report: { verdict: "blocked" as const, findings: [], checksRun: [], estimatedSeconds: 40 },
      evidence: [], youtubeMetadata: {}, provider: "anthropic", model: "m",
    };
    expect((await store.saveScriptVersion(input)).version).toBe(1);
    const second = await store.saveScriptVersion({ ...input, report: { ...input.report, verdict: "pass" } });
    expect(second.version).toBe(2);

    const candidate = await store.getCandidate(candidateId);
    expect(candidate).toMatchObject({ status: "scripted", format: "flash", hasScript: true });
    expect(candidate?.articles.map((item) => item.id).sort()).toEqual(items.map((item) => item.id).sort());

    const { data } = await admin.from("scripts").select("status, current_version").eq("id", second.scriptId).single();
    expect(data).toEqual({ status: "in_review", current_version: 2 });
  });

  it("returns null for an unknown candidate", async () => {
    await expect(store.getCandidate(randomUUID())).resolves.toBeNull();
  });

  it("adds usage to the monthly spend", async () => {
    const before = await store.monthSpendUsd();
    await store.record({ provider: "anthropic", feature: "script", model: "m", inputTokens: 1, outputTokens: 1, characters: null, estimatedCostUsd: 0.25, latencyMs: 5, success: true });
    expect((await store.monthSpendUsd()) - before).toBeCloseTo(0.25);
  });

  it("gives the anon key no access", async () => {
    const anon = createClient(url, anonKey, { auth: { persistSession: false } });
    const read = await anon.from("news_sources").select("id");
    const rpc = await anon.rpc("provider_spend_usd");
    expect(read.error?.code).toBe("42501");
    expect(rpc.error).not.toBeNull();
  });
});
