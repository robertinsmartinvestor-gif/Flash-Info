import { loadConfiguredSources } from "@/src/news/sources";
import { runIngest } from "@/src/pipeline/ingest";
import { MemoryStore } from "@/src/store/memory";
import type { EditorialStore } from "@/src/store/types";
import { failJob, supabaseStoreFromEnv } from "./shared";

const dryRun = process.argv.includes("--dry-run");
const top = Number(process.argv[process.argv.indexOf("--top") + 1]) || 15;

async function main(): Promise<void> {
  let store: EditorialStore;
  if (dryRun) {
    store = new MemoryStore(loadConfiguredSources());
  } else {
    const supabase = supabaseStoreFromEnv();
    await supabase.syncSources(loadConfiguredSources());
    store = supabase;
  }

  const report = await runIngest(store);

  for (const source of report.sources) {
    console.log(`${source.slug.padEnd(16)} ${source.status.padEnd(14)} ${source.items} voci, ${source.kept} valide`);
  }
  const multi = report.ranked.filter((event) => event.independentSources > 1).length;
  console.log(`\nArticoli nuovi: ${report.newArticles}. Eventi: ${report.ranked.length}, ${multi} con più fonti. Candidati: ${report.candidates}.`);
  const failed = report.sources.filter((source) => source.status !== "ok" && source.status !== "not_modified").length;
  if (failed === report.sources.length) throw new Error("all_sources_failed");

  if (dryRun) {
    for (const event of report.ranked.slice(0, top)) {
      console.log(`\n[${event.score.total}] ${event.title}`);
      console.log(`  ${event.category ?? "?"} | ${event.territory ?? "?"} | fonti indipendenti: ${event.independentSources} | ${event.eligible ? "candidabile" : event.ineligibleReason}`);
      for (const article of event.cluster.articles) console.log(`  - ${article.publisher}: ${article.title.slice(0, 90)}`);
    }
  }
}

main().catch(failJob);
