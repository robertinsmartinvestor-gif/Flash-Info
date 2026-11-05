import { describe, expect, it } from "vitest";
import { clusterArticles } from "@/src/news/cluster";
import { DEFAULT_RANK_OPTIONS, rankCluster } from "@/src/news/rank";
import type { Cluster } from "@/src/news/types";
import { article, NOW } from "../helpers/fixtures";

/** Real headlines from 5 November 2026, with unrelated news around them for realistic term statistics. */
const fineVita = [
  ["ansa", "Impugnata la legge del Veneto sul fine vita, il governo si divide"],
  ["rai", "Il governo impugna la legge del Veneto sul fine vita"],
  ["fatto", "Fine vita, il governo impugna la legge del Veneto governato dalla Lega"],
  ["sky", "Fine vita, il governo impugna la legge del Veneto: Salvini non vota in Cdm"],
] as const;
const paraguay = [
  ["agi", "Paraguay, crac della banca Ueno: il presidente Peña si dimette"],
  ["rai", "Crac Ueno Bank, correntisti senza soldi e il presidente del Paraguay si dimette"],
] as const;
const noise = [
  "Borsa: Milano chiude in calo, Ftse Mib -1,03%",
  "Lo spread tra Btp e Bund chiude in rialzo a 109 punti base",
  "Pirelli, in 9 mesi utile +7,4% a 430,2 milioni",
  "Pierpaolo Piccioli lascia la direzione creativa di Balenciaga",
  "Sanremo 2027, la Gialappa's Band conduce il Controfestival",
  "Kaufmann condannato all'ergastolo per il duplice omicidio di Villa Pamphili",
  "La Francia si ferma per lo sciopero, almeno 600 mila in piazza",
  "Il governo presenta il decreto bollette, slitta il voto",
];

const build = (rows: ReadonlyArray<readonly [string, string]>) => rows.map(([groupKey, title]) => article({ groupKey, title }));
const titles = (cluster: Cluster | undefined) => cluster?.articles.map((item) => item.title) ?? [];

describe("clusterArticles", () => {
  const dataset = [...build(fineVita), ...build(paraguay), ...noise.map((title) => article({ title }))];
  const clusters = clusterArticles(dataset, []);

  it("groups different wordings of one event", () => {
    const found = clusters.find((cluster) => titles(cluster).some((title) => title.includes("Veneto")));
    expect(found?.articles).toHaveLength(4);
    expect(clusters.find((cluster) => titles(cluster).some((title) => title.includes("Paraguay")))?.articles).toHaveLength(2);
  });

  it("keeps unrelated news apart, even sharing generic words like governo", () => {
    expect(clusters).toHaveLength(2 + noise.length);
  });

  it("does not merge outside the time window", () => {
    const old = article({ groupKey: "rai", title: fineVita[1][1], publishedAt: "2026-11-01T10:00:00.000Z" });
    const recent = article({ title: fineVita[0][1] });
    expect(clusterArticles([old, recent, ...noise.map((title) => article({ title }))], [])).toHaveLength(2 + noise.length);
  });

  it("adds new articles to a running event", () => {
    const seed = article({ title: fineVita[0][1] });
    const [cluster, ...others] = clusterArticles(
      [article({ groupKey: "rai", title: fineVita[1][1] }), ...noise.map((title) => article({ title }))],
      [{ id: "event-1", title: seed.title, status: "open", articles: [seed] }],
    );
    expect(cluster).toMatchObject({ eventId: "event-1", updateOfEventId: null });
    expect(cluster?.articles).toHaveLength(2);
    expect(others).toHaveLength(noise.length);
  });

  it("opens an update instead of reopening a covered event", () => {
    const seed = article({ title: fineVita[0][1] });
    const fresh = article({ groupKey: "rai", title: fineVita[1][1] });
    const clustersAfter = clusterArticles(
      [fresh, ...noise.map((title) => article({ title }))],
      [{ id: "event-1", title: seed.title, status: "covered", articles: [seed] }],
    );
    const update = clustersAfter.find((cluster) => cluster.articles.includes(fresh));
    expect(update).toMatchObject({ eventId: null, updateOfEventId: "event-1" });
    expect(update?.articles).toHaveLength(1);
  });
});

describe("rankCluster", () => {
  const options = { ...DEFAULT_RANK_OPTIONS, now: NOW };
  const cluster = (articles: ReturnType<typeof article>[]): Cluster => ({
    eventId: null, updateOfEventId: null, articles, added: articles.map((item) => ({ article: item, similarity: 1 })),
  });

  it("requires independent confirmation", () => {
    const ranked = rankCluster(cluster([article()]), options);
    expect(ranked).toMatchObject({ eligible: false, ineligibleReason: "single_source" });
  });

  it("does not count two outlets of one group as independent", () => {
    const ranked = rankCluster(cluster([article({ groupKey: "ansa" }), article({ groupKey: "ansa" })]), options);
    expect(ranked).toMatchObject({ independentSources: 1, eligible: false });
  });

  it("accepts official sources alone", () => {
    expect(rankCluster(cluster([article({ official: true })]), options).eligible).toBe(true);
  });

  it("excludes services however many sources carry them", () => {
    const lotto = [article({ title: "SuperEnalotto, estrazione di oggi" }), article({ groupKey: "rai", title: "SuperEnalotto, estrazione di oggi" })];
    expect(rankCluster(cluster(lotto), options)).toMatchObject({ eligible: false, ineligibleReason: "low_value" });
  });

  it("ranks better-confirmed stories higher", () => {
    const one = rankCluster(cluster([article(), article({ groupKey: "rai" })]), options);
    const many = rankCluster(cluster([article(), article({ groupKey: "rai" }), article({ groupKey: "agi" }), article({ groupKey: "sky" })]), options);
    expect(many.score.total).toBeGreaterThan(one.score.total);
  });

  it("decays with age", () => {
    const fresh = rankCluster(cluster([article(), article({ groupKey: "rai" })]), options);
    const stale = rankCluster(cluster([article({ publishedAt: "2026-11-05T00:00:00.000Z" }), article({ groupKey: "rai", publishedAt: "2026-11-05T00:00:00.000Z" })]), options);
    expect(stale.score.recency).toBeLessThan(fresh.score.recency);
  });
});
