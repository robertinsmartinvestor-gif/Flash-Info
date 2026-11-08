import { foldText, wordCount } from "@/src/core/text";
import type { FormatConfig } from "@/src/editorial/formats";
import { draftNarration, estimateSeconds } from "@/src/editorial/generate";
import type { EvidenceItem, ScriptDraft, ScriptSentence } from "@/src/editorial/schema";

export type Severity = "blocker" | "warning";
export type Verdict = "pass" | "needs_review" | "blocked";

export interface QcFinding {
  check: string;
  severity: Severity;
  message: string;
  sentence?: number;
}

export interface QcReport {
  verdict: Verdict;
  findings: QcFinding[];
  checksRun: string[];
  estimatedSeconds: number;
}

const SENSATIONAL = [
  "shock", "choc", "clamoroso", "clamorosa", "incredibile", "sconvolgente", "pazzesco", "pazzesca", "da brividi", "bomba",
  "terrificante", "scandaloso", "non crederai", "assurdo", "assurda", "apocalisse", "follia", "strage di",
];
const SENSITIVE = ["suicid", "stupr", "violenza sessuale", "minorenne", "pedofil", "femminicidio", "bambin", "abus"];
// Reporting verbs only. A bare "per" used to pass here, and it also matches "per tutelare".
const ATTRIBUTION = /\b(secondo|stando a|afferma\w*|ha detto|hanno detto|dichiara\w*|sostien\w*|spiega\w*|riferisc\w*|fa sapere|fanno sapere|avvert\w*|denuncia\w*|ritien\w*|definit\w*|definisc\w*|parla\w* di|accus\w*|critica\w*|giudica\w*|commenta\w*)\b/;
const RELATIVE_DAYS = /\b(oggi|stamattina|stamane|stasera|stanotte|ieri|domani)\b/;
const WEEKDAY_OR_MONTH = new Set([
  "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato", "domenica", "gennaio", "febbraio", "marzo", "aprile", "maggio",
  "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre",
].map(foldText));
const MAX_EVIDENCE_AGE_MS = 48 * 60 * 60 * 1000;

function romeDay(date: Date): string {
  return date.toLocaleDateString("en-CA", { timeZone: "Europe/Rome" });
}

/** Comparable form: no accents, punctuation or spacing differences. */
function comparable(text: string): string {
  return foldText(text).replace(/[^\p{L}\p{N}%]+/gu, " ").trim();
}

/** "1.500", "1500" and "1,5" must compare by digits; bare years and ordinals are included. */
function extractNumbers(text: string): string[] {
  return (text.match(/\d+(?:[.,]\d+)*/g) ?? []).map((value) => value.replace(/[.,](?=\d{3}\b)/g, "").replace(",", "."));
}

/** Capitalized words after the first of a sentence: a cheap detector of names the model introduced. */
function extractProperNouns(text: string): string[] {
  // Apostrophes split words, so "dall'Unione" yields "Unione".
  const words = text.match(/\p{L}[\p{L}-]*/gu) ?? [];
  return words
    .slice(1)
    .filter((word) => /^\p{Lu}/u.test(word) && word.length > 2)
    .map((word) => comparable(word))
    .filter((word) => !WEEKDAY_OR_MONTH.has(word));
}

function evidenceText(item: EvidenceItem): string {
  return comparable(`${item.title} ${item.summary}`);
}

function checkSentence(sentence: ScriptSentence, index: number, byId: Map<string, EvidenceItem>, now: Date): QcFinding[] {
  const findings: QcFinding[] = [];
  const add = (check: string, severity: Severity, message: string) => findings.push({ check, severity, message, sentence: index });

  if (sentence.kind === "connective") {
    if (extractNumbers(sentence.text).length || extractProperNouns(sentence.text).length) {
      add("connective_has_facts", "blocker", "Una frase di raccordo contiene numeri o nomi propri: va citata come fatto.");
    }
    return findings;
  }

  if (sentence.evidence.length === 0) {
    add("claim_without_source", "blocker", "Affermazione senza alcuna fonte.");
    return findings;
  }

  const cited: EvidenceItem[] = [];
  for (const ref of sentence.evidence) {
    const item = byId.get(ref.evidenceId);
    if (!item) {
      add("unknown_source", "blocker", `Fonte inesistente: ${ref.evidenceId}.`);
      continue;
    }
    cited.push(item);
    if (!comparable(ref.quote) || !evidenceText(item).includes(comparable(ref.quote))) {
      add("quote_not_in_source", "blocker", `La citazione non compare in ${ref.evidenceId} (${item.publisher}).`);
    }
  }
  if (cited.length === 0) return findings;

  // The publisher of a cited source can be named: "secondo la Rai" is an attribution.
  const support = cited.map((item) => `${comparable(item.publisher)} ${evidenceText(item)}`).join(" ");
  const supportNumbers = new Set(extractNumbers(cited.map((item) => `${item.title} ${item.summary}`).join(" ")));
  for (const number of extractNumbers(sentence.text)) {
    if (!supportNumbers.has(number)) add("number_not_in_source", "blocker", `Il numero ${number} non compare nelle fonti citate.`);
  }
  for (const noun of extractProperNouns(sentence.text)) {
    if (!support.includes(noun)) add("name_not_in_source", "blocker", `"${noun}" non compare nelle fonti citate.`);
  }

  const relative = foldText(sentence.text).match(RELATIVE_DAYS)?.[1];
  if (relative) {
    const today = romeDay(now);
    const yesterday = romeDay(new Date(now.getTime() - 24 * 60 * 60 * 1000));
    const newest = cited.map((item) => romeDay(new Date(item.publishedAt))).sort().at(-1);
    const coherent = relative === "ieri" ? newest === today || newest === yesterday : newest === today;
    if (!coherent) add("temporal_mismatch", "blocker", `"${relative}" non è coerente con la data delle fonti citate (${newest}).`);
  }

  if (sentence.kind === "interpretation" && !ATTRIBUTION.test(foldText(sentence.text))) {
    add("interpretation_unattributed", "blocker", "Interpretazione senza attribuzione esplicita.");
  }
  return findings;
}

function checkRepetition(sentences: ScriptSentence[]): QcFinding[] {
  const findings: QcFinding[] = [];
  const sets = sentences.map((sentence) => new Set(comparable(sentence.text).split(" ").filter((word) => word.length > 3)));
  sets.forEach((current, i) => {
    sets.slice(0, i).forEach((previous) => {
      const shared = [...current].filter((word) => previous.has(word)).length;
      const union = new Set([...current, ...previous]).size;
      if (union >= 4 && shared / union > 0.6) {
        findings.push({ check: "repetition", severity: "warning", message: "Due frasi ripetono lo stesso contenuto.", sentence: i });
      }
    });
  });
  return findings;
}

function checkTone(draft: ScriptDraft): QcFinding[] {
  const findings: QcFinding[] = [];
  const hits = (text: string) => SENSATIONAL.filter((word) => foldText(text).includes(word));

  for (const word of hits(draft.title)) {
    findings.push({ check: "sensational_title", severity: "blocker", message: `Titolo sensazionalistico: "${word}".` });
  }
  if (/[!]{1}|\p{Extended_Pictographic}/u.test(draft.title) || /\b\p{Lu}{4,}\b.*\b\p{Lu}{4,}\b/u.test(draft.title)) {
    findings.push({ check: "sensational_title", severity: "blocker", message: "Titolo con punti esclamativi, emoji o maiuscole enfatiche." });
  }
  draft.sentences.forEach((sentence, index) => {
    for (const word of hits(sentence.text)) {
      findings.push({ check: "sensational_language", severity: "warning", message: `Linguaggio sensazionalistico: "${word}".`, sentence: index });
    }
  });
  return findings;
}

const REPORTING_VERB = /\b(ha detto|ha dichiarato|ha aggiunto|ha affermato)\b/;
const FILLER_OPENING = /^(ecco|vediamo|scopriamo|andiamo a)\b/;
const MAX_REPORTING_VERBS = 2;
const MAX_DIRECT_QUOTES = 2;

/** Sound narration. These go to the editor, since they say nothing about accuracy. */
function checkStyle(draft: ScriptDraft): QcFinding[] {
  const findings: QcFinding[] = [];
  const texts = draft.sentences.map((sentence) => foldText(sentence.text));
  if (texts.filter((text) => REPORTING_VERB.test(text)).length > MAX_REPORTING_VERBS) {
    findings.push({ check: "monotone_style", severity: "warning", message: "Troppe frasi costruite su \"ha detto\": il testo suona come un elenco." });
  }
  if (texts.filter((text) => text.includes('"')).length > MAX_DIRECT_QUOTES) {
    findings.push({ check: "too_many_quotes", severity: "warning", message: "Troppe citazioni dirette." });
  }
  texts.forEach((text, index) => {
    if (FILLER_OPENING.test(text)) {
      findings.push({ check: "filler_sentence", severity: "warning", message: "Frase riempitiva: annuncia il contenuto invece di darlo.", sentence: index });
    }
  });
  return findings;
}

function checkMetadata(draft: ScriptDraft): QcFinding[] {
  const findings: QcFinding[] = [];
  if (!draft.title.trim() || draft.title.length > 100) {
    findings.push({ check: "title_length", severity: "blocker", message: "Il titolo deve avere tra 1 e 100 caratteri." });
  }
  if (draft.sentences.length === 0) {
    findings.push({ check: "empty_script", severity: "blocker", message: "Lo script non contiene frasi." });
  }
  return findings;
}

function checkSources(draft: ScriptDraft, byId: Map<string, EvidenceItem>, format: FormatConfig, now: Date): QcFinding[] {
  const findings: QcFinding[] = [];
  const cited = [...new Set(draft.sentences.flatMap((sentence) => sentence.evidence.map((ref) => ref.evidenceId)))]
    .flatMap((id) => byId.get(id) ?? []);
  const groups = new Set(cited.map((item) => item.groupKey)).size;
  if (groups < format.minCitedPublishers) {
    findings.push({ check: "too_few_sources", severity: "blocker", message: `Citate ${groups} fonti indipendenti, ne servono ${format.minCitedPublishers}.` });
  }
  const newest = Math.max(...cited.map((item) => Date.parse(item.publishedAt)), 0);
  if (cited.length && now.getTime() - newest > MAX_EVIDENCE_AGE_MS) {
    findings.push({ check: "stale_sources", severity: "blocker", message: "Tutte le fonti citate hanno più di 48 ore." });
  }
  return findings;
}

function checkDuration(seconds: number, format: FormatConfig): QcFinding[] {
  if (seconds >= format.minSeconds && seconds <= format.maxSeconds) return [];
  const tolerance = format.maxSeconds * 1.2;
  return [{
    check: "duration",
    severity: seconds > tolerance || seconds < format.minSeconds * 0.5 ? "blocker" : "warning",
    message: `Durata stimata ${seconds}s, attesa ${format.minSeconds}-${format.maxSeconds}s.`,
  }];
}

const COVER_HEADLINE_WORDS = { min: 3, max: 7 } as const;
const MAX_COVER_HEADLINE_CHARS = 40;
const MAX_COVER_SUBLINE_CHARS = 50;

/** The text a cover shows as claims, for the source checks and the verifier. */
export function coverClaim(draft: ScriptDraft): string | null {
  if (!draft.cover) return null;
  return [draft.cover.headline, draft.cover.subline].map((text) => text.trim()).filter(Boolean).join(". ");
}

/**
 * The cover is read before the video, so it obeys the same rules as a fact
 * sentence (cited, quoted verbatim, no number or name the sources lack) plus its
 * own limits of length and tone. Versions saved before covers existed have none:
 * their cover falls back to the title, which checkMetadata and checkTone cover.
 */
function checkCover(draft: ScriptDraft, byId: Map<string, EvidenceItem>, now: Date): QcFinding[] {
  const cover = draft.cover;
  const claim = coverClaim(draft);
  if (!cover || claim === null) return [];
  const findings: QcFinding[] = [];
  const add = (check: string, message: string) => findings.push({ check, severity: "blocker", message: `Copertina: ${message}` });

  const words = wordCount(cover.headline);
  if (words < COVER_HEADLINE_WORDS.min || words > COVER_HEADLINE_WORDS.max || cover.headline.trim().length > MAX_COVER_HEADLINE_CHARS) {
    add("cover_headline", `il titolo deve avere da ${COVER_HEADLINE_WORDS.min} a ${COVER_HEADLINE_WORDS.max} parole e al massimo ${MAX_COVER_HEADLINE_CHARS} caratteri.`);
  }
  if (cover.subline.trim().length > MAX_COVER_SUBLINE_CHARS) {
    add("cover_subline", `la riga secondaria supera ${MAX_COVER_SUBLINE_CHARS} caratteri.`);
  }
  if (/[!?]|\p{Extended_Pictographic}/u.test(claim) || SENSATIONAL.some((word) => foldText(claim).includes(word))) {
    add("cover_tone", "punti esclamativi, domande, emoji o linguaggio sensazionalistico.");
  }
  for (const finding of checkSentence({ text: claim, kind: "fact", evidence: cover.evidence }, -1, byId, now)) {
    findings.push({ check: finding.check, severity: finding.severity, message: `Copertina: ${finding.message}` });
  }
  return findings;
}

function checkSensitive(draft: ScriptDraft): QcFinding[] {
  const text = foldText(draftNarration(draft));
  return SENSITIVE.some((word) => text.includes(word))
    ? [{ check: "sensitive_topic", severity: "warning", message: "Tema delicato: serve attenzione editoriale." }]
    : [];
}

const CHECKS_RUN = [
  "sources", "quotes_verbatim", "numbers_supported", "names_supported", "temporal_coherence",
  "repetition", "tone", "style", "duration", "attribution", "sensitive_topic", "metadata", "cover",
];

/**
 * Deterministic checks: same input, same result. They run on code, not on a
 * model's opinion, and "pass" only means ready for a human, never publishable.
 */
export function runQualityChecks(draft: ScriptDraft, pack: EvidenceItem[], format: FormatConfig, now: Date): QcReport {
  const byId = new Map(pack.map((item) => [item.evidenceId, item]));
  const estimatedSeconds = estimateSeconds(draftNarration(draft), format);
  const findings = [
    ...checkMetadata(draft),
    ...checkSources(draft, byId, format, now),
    ...draft.sentences.flatMap((sentence, index) => checkSentence(sentence, index, byId, now)),
    ...checkRepetition(draft.sentences),
    ...checkTone(draft),
    ...checkStyle(draft),
    ...checkDuration(estimatedSeconds, format),
    ...checkSensitive(draft),
    ...checkCover(draft, byId, now),
  ];
  return { verdict: verdictOf(findings), findings, checksRun: CHECKS_RUN, estimatedSeconds };
}

export function verdictOf(findings: QcFinding[]): Verdict {
  if (findings.some((finding) => finding.severity === "blocker")) return "blocked";
  return findings.length ? "needs_review" : "pass";
}
