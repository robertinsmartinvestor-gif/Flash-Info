/**
 * Copy detection for digest text, mirrored by private.digest_copy_reason in the
 * database (the database is the gate; this only warns the editor while typing).
 * The headline may not equal a source title or share 6 words in a row with one;
 * the summary may not share 8 words in a row with a source title or summary.
 */
export const HEADLINE_RUN = 6;
export const SUMMARY_RUN = 8;

export function foldWords(text: string): string[] {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/['’]/g, " ")
    .split(/[^a-z0-9]+/).filter(Boolean);
}

export function ngrams(text: string, size: number): Set<string> {
  const words = foldWords(text);
  const grams = new Set<string>();
  for (let index = 0; index + size <= words.length; index += 1) grams.add(words.slice(index, index + size).join(" "));
  return grams;
}

/** The first copied run of words, or null. */
function sharedRun(text: string, sources: string[], size: number): string | null {
  const own = ngrams(text, size);
  for (const source of sources) for (const gram of ngrams(source, size)) if (own.has(gram)) return gram;
  return null;
}

export interface SourceText {
  title: string;
  summary: string;
}

export type CopyFinding = { field: "headline" | "summary"; run: string };

export function findCopiedText(headline: string, summary: string, sources: SourceText[]): CopyFinding[] {
  const findings: CopyFinding[] = [];
  const titles = sources.map((source) => source.title);
  const folded = foldWords(headline).join(" ");
  const equal = folded.length > 0 && titles.some((title) => foldWords(title).join(" ") === folded);
  const headlineRun = equal ? folded : sharedRun(headline, titles, HEADLINE_RUN);
  if (headlineRun) findings.push({ field: "headline", run: headlineRun });
  const summaryRun = sharedRun(summary, [...titles, ...sources.map((source) => source.summary)], SUMMARY_RUN);
  if (summaryRun) findings.push({ field: "summary", run: summaryRun });
  return findings;
}
