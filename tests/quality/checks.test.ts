import { describe, expect, it } from "vitest";
import { FORMATS } from "@/src/editorial/formats";
import { buildYoutubeMetadata, hashtagsFor, toHashtag } from "@/src/editorial/generate";
import type { ScriptDraft, ScriptSentence } from "@/src/editorial/schema";
import { runQualityChecks } from "@/src/quality/checks";
import { NOW, PACK, validDraft, withoutCover } from "../helpers/fixtures";

const flash = FORMATS.flash;
const run = (draft: ScriptDraft, now = NOW) => runQualityChecks(draft, PACK, flash, now);
const checks = (draft: ScriptDraft, now = NOW) => run(draft, now).findings.map((finding) => finding.check);

function withSentence(sentence: Partial<ScriptSentence>): ScriptDraft {
  const draft = validDraft();
  draft.sentences[0] = { ...draft.sentences[0]!, ...sentence };
  return draft;
}

describe("runQualityChecks", () => {
  it("passes a compliant draft", () => {
    const report = run(validDraft());
    expect(report.findings).toEqual([]);
    expect(report.verdict).toBe("pass");
  });

  it("blocks an invented source", () => {
    const draft = withSentence({ evidence: [{ evidenceId: "E9", quote: "qualcosa" }] });
    expect(checks(draft)).toContain("unknown_source");
    expect(run(draft).verdict).toBe("blocked");
  });

  it("blocks a fact with no source", () => {
    expect(checks(withSentence({ evidence: [] }))).toContain("claim_without_source");
  });

  it("blocks a quote the source does not contain", () => {
    expect(checks(withSentence({ evidence: [{ evidenceId: "E1", quote: "Il governo ha annullato la legge" }] }))).toContain("quote_not_in_source");
  });

  it("blocks an empty quote", () => {
    expect(checks(withSentence({ evidence: [{ evidenceId: "E1", quote: " " }] }))).toContain("quote_not_in_source");
  });

  it("accepts a quote differing only in accents, case and punctuation", () => {
    const draft = withSentence({ evidence: [{ evidenceId: "E1", quote: "IL CONSIGLIO DEI MINISTRI, ha deciso di impugnare la legge regionale" }] });
    expect(checks(draft)).not.toContain("quote_not_in_source");
  });

  it("blocks a number absent from the cited source, even with a true quote", () => {
    expect(checks(withSentence({ text: "Il governo ha impugnato 12 leggi regionali." }))).toContain("number_not_in_source");
  });

  it("does not let a number from an uncited source pass", () => {
    expect(checks(withSentence({ text: "La legge era stata approvata 3 mesi fa." }))).toContain("number_not_in_source");
  });

  it("matches Italian number formats", () => {
    const pack = [{ ...PACK[0]!, summary: "Sono 1.500 i partecipanti e la crescita è dell'1,5%." }, PACK[1]!];
    const draft = withSentence({ text: "I partecipanti sono 1500 con una crescita dell'1,5%.", evidence: [{ evidenceId: "E1", quote: "Sono 1.500 i partecipanti" }] });
    expect(runQualityChecks(draft, pack, flash, NOW).findings.map((finding) => finding.check)).not.toContain("number_not_in_source");
  });

  it("blocks a person the source never names", () => {
    expect(checks(withSentence({ text: "Secondo Meloni il Consiglio dei ministri ha deciso." }))).toContain("name_not_in_source");
  });

  it("catches names after an apostrophe", () => {
    expect(checks(withSentence({ text: "La decisione è stata presa dall'Unione europea." }))).toContain("name_not_in_source");
  });

  it("blocks facts disguised as connective text", () => {
    expect(checks(withSentence({ kind: "connective", evidence: [], text: "Intanto Meloni resta in silenzio." }))).toContain("connective_has_facts");
    expect(checks(withSentence({ kind: "connective", evidence: [], text: "Sono 40 i voti." }))).toContain("connective_has_facts");
  });

  it("blocks an unattributed interpretation", () => {
    expect(checks(withSentence({ kind: "interpretation", text: "La scelta della Regione era giusta." }))).toContain("interpretation_unattributed");
  });

  it("accepts an interpretation attributed with a reporting verb", () => {
    const draft = withSentence({ kind: "interpretation", text: "Salvini aveva definito la legge regionale sbagliata." });
    expect(checks(draft)).not.toContain("interpretation_unattributed");
  });

  it("does not take a purpose clause for an attribution", () => {
    const draft = withSentence({ kind: "interpretation", text: "Un gesto giusto per tutelare la legge regionale." });
    expect(checks(draft)).toContain("interpretation_unattributed");
  });

  it("lets a script name the publisher of a cited source", () => {
    expect(checks(withSentence({ text: "Il Consiglio dei ministri ha deciso, riferisce ANSA." }))).not.toContain("name_not_in_source");
  });

  it("does not read the digits of a cited publisher's name as a figure", () => {
    const pack = PACK.map((item) => (item.evidenceId === "E1" ? { ...item, publisher: "TGCom24" } : item));
    const quiet = (text: string) => runQualityChecks(withSentence({ text }), pack, flash, NOW).findings.map((finding) => finding.check);
    expect(quiet("Il Consiglio dei ministri ha deciso, secondo TGCom24.")).not.toContain("number_not_in_source");
    expect(quiet("Il Consiglio dei ministri ha deciso, secondo tgcom24.")).not.toContain("number_not_in_source");
    // A real figure next to the name is still checked.
    expect(quiet("Secondo TGCom24 il Consiglio dei ministri ha impugnato 24 leggi.")).toContain("number_not_in_source");
    // The name of a source that is not cited still counts.
    expect(checks(withSentence({ text: "Il Consiglio dei ministri ha deciso, secondo TGCom24." }))).toContain("number_not_in_source");
  });

  it("still blocks the publisher of a source that is not cited", () => {
    expect(checks(withSentence({ text: "Il Consiglio dei ministri ha deciso, riferisce la Rai." }))).toContain("name_not_in_source");
  });

  it("blocks 'oggi' on sources from another day", () => {
    const draft = withSentence({ text: "Oggi il Consiglio dei ministri ha deciso." });
    expect(checks(draft, NOW)).not.toContain("temporal_mismatch");
    expect(checks(draft, new Date("2026-11-06T20:00:00Z"))).toContain("temporal_mismatch");
  });

  it("evaluates the day in Rome, not UTC", () => {
    const draft = withSentence({ text: "Oggi il Consiglio dei ministri ha deciso." });
    expect(checks(draft, new Date("2026-11-05T23:30:00Z"))).toContain("temporal_mismatch");
  });

  it("blocks sources older than 48 hours", () => {
    expect(checks(validDraft(), new Date("2026-11-08T20:00:00Z"))).toContain("stale_sources");
  });

  it("requires independent cited sources, not just listed ones", () => {
    const draft = validDraft();
    draft.sentences = draft.sentences.filter((sentence) => sentence.evidence.every((ref) => ref.evidenceId === "E1"));
    expect(checks(draft)).toContain("too_few_sources");
  });

  it("does not count two outlets of the same group", () => {
    const pack = PACK.map((item) => ({ ...item, groupKey: "ansa" }));
    expect(runQualityChecks(validDraft(), pack, flash, NOW).findings.map((finding) => finding.check)).toContain("too_few_sources");
  });

  it("blocks a sensational title and flags sensational narration", () => {
    const title = { ...validDraft(), title: "Clamoroso: il governo impugna la legge" };
    expect(checks(title)).toContain("sensational_title");
    expect(checks({ ...validDraft(), title: "🔴 Fine vita" })).toContain("sensational_title");
    expect(checks({ ...validDraft(), title: "Fine vita!" })).toContain("sensational_title");
    const body = withSentence({ text: "Una decisione incredibile del Consiglio dei ministri." });
    expect(run(body).findings).toContainEqual(expect.objectContaining({ check: "sensational_language", severity: "warning" }));
  });

  it("flags repetition for review", () => {
    const draft = validDraft();
    draft.sentences[1] = { ...draft.sentences[0]! };
    expect(checks(draft)).toContain("repetition");
  });

  it("flags a script too short, and blocks one far too long", () => {
    const short = validDraft();
    short.sentences = short.sentences.slice(0, 2);
    expect(run(short).findings).toContainEqual(expect.objectContaining({ check: "duration", severity: "blocker" }));

    const long = validDraft();
    long.sentences = [...long.sentences, ...long.sentences, ...long.sentences];
    expect(run(long).findings).toContainEqual(expect.objectContaining({ check: "duration", severity: "blocker" }));
  });

  it("sends sensitive topics to human review", () => {
    const draft = withSentence({ text: "Il Consiglio dei ministri ha discusso di femminicidio." });
    expect(run(draft).findings).toContainEqual(expect.objectContaining({ check: "sensitive_topic", severity: "warning" }));
  });

  it("blocks an empty script", () => {
    expect(checks({ ...validDraft(), sentences: [] })).toContain("empty_script");
  });
});

describe("style checks", () => {
  const replaceTexts = (texts: string[]) => {
    const draft = validDraft();
    texts.forEach((text, index) => {
      draft.sentences[index + 3] = { ...draft.sentences[index + 3]!, text };
    });
    return draft;
  };

  it("sends a list of statements to the editor, as a warning", () => {
    const draft = replaceTexts(["Ha detto che resta al centro.", "Poi ha detto che la legge conta.", "Infine ha detto che seguirà il voto."]);
    expect(run(draft).findings).toContainEqual(expect.objectContaining({ check: "monotone_style", severity: "warning" }));
  });

  it("flags too many direct quotes", () => {
    const draft = replaceTexts(['La frase "uno" resta.', 'La frase "due" resta.', 'La frase "tre" resta.']);
    expect(checks(draft)).toContain("too_many_quotes");
  });

  it("flags sentences that announce instead of telling", () => {
    const draft = validDraft();
    draft.sentences[9] = { text: "Ecco cosa ha detto ai giornalisti.", kind: "connective", evidence: [] };
    expect(run(draft).findings).toContainEqual(expect.objectContaining({ check: "filler_sentence", severity: "warning", sentence: 9 }));
  });

  it("never blocks on style alone", () => {
    const draft = replaceTexts(["Ha detto che resta al centro.", "Poi ha detto che la legge conta.", "Infine ha detto che seguirà il voto."]);
    expect(run(draft).verdict).toBe("needs_review");
  });
});

describe("buildYoutubeMetadata", () => {
  it("credits only sources the script cites, with their real URLs", () => {
    const draft = validDraft();
    draft.sentences = draft.sentences.filter((sentence) => sentence.evidence.every((ref) => ref.evidenceId === "E1"));
    const metadata = buildYoutubeMetadata(draft, PACK);
    expect(metadata.sources).toEqual([{ publisher: "ANSA", url: "https://www.ansa.it/a" }]);
    expect(metadata.description).toContain("https://www.ansa.it/a");
    expect(metadata.description).not.toContain("rainews");
  });

  it("states the synthetic voice", () => {
    expect(buildYoutubeMetadata(validDraft(), PACK).description).toContain("Voce sintetica");
  });

  it("ends the description with three hashtags, one from the story", () => {
    const draft = validDraft();
    draft.tags = ["Decreto bollette", "accise"];
    expect(buildYoutubeMetadata(draft, PACK).description.endsWith("\n\n#notizie #italia #decretobollette")).toBe(true);
  });

  it("keeps the hashtags when the description hits the length cap", () => {
    const draft = validDraft();
    draft.summary = "x".repeat(6000);
    draft.tags = ["gasolio"];
    const { description } = buildYoutubeMetadata(draft, PACK);
    expect(description.length).toBeLessThanOrEqual(5000);
    expect(description.endsWith("#gasolio")).toBe(true);
  });
});

describe("hashtags", () => {
  it("turns tags into plain hashtags", () => {
    expect(toHashtag("Città più vivibili")).toBe("#cittapiuvivibili");
    expect(toHashtag("Ue")).toBeNull();
    expect(toHashtag("#<script>")).toBe("#script");
    expect(toHashtag("x".repeat(40))).toBeNull();
  });

  it("skips tags that repeat the fixed ones and falls back to the two fixed", () => {
    expect(hashtagsFor(["Italia", "Meloni"])).toEqual(["#notizie", "#italia", "#meloni"]);
    expect(hashtagsFor(["--", "Ue"])).toEqual(["#notizie", "#italia"]);
  });
});

describe("cover checks", () => {
  const withCover = (cover: Partial<NonNullable<ScriptDraft["cover"]>>): ScriptDraft => {
    const draft = validDraft();
    return { ...draft, cover: { ...draft.cover!, ...cover } };
  };
  const coverChecks = (draft: ScriptDraft) =>
    runQualityChecks(draft, PACK, FORMATS.flash, NOW).findings.filter((finding) => finding.message.startsWith("Copertina"));

  it("passes a short cover the cited sources support", () => {
    expect(coverChecks(validDraft())).toEqual([]);
    expect(runQualityChecks(validDraft(), PACK, FORMATS.flash, NOW).checksRun).toContain("cover");
  });

  it("blocks a number or a name the cited sources do not contain", () => {
    const checks = coverChecks(withCover({ subline: "La legge era stata approvata 5 mesi fa con Meloni" })).map((finding) => finding.check);
    expect(checks).toContain("number_not_in_source");
    expect(checks).toContain("name_not_in_source");
  });

  it("blocks a cover with no source, an unknown source or a quote not in the source", () => {
    expect(coverChecks(withCover({ evidence: [] })).map((finding) => finding.check)).toContain("claim_without_source");
    expect(coverChecks(withCover({ evidence: [{ evidenceId: "E9", quote: "x" }] })).map((finding) => finding.check)).toContain("unknown_source");
    expect(coverChecks(withCover({ evidence: [{ evidenceId: "E2", quote: "frase inventata" }] })).map((finding) => finding.check)).toContain("quote_not_in_source");
  });

  it("keeps the headline between 3 and 7 words and 40 characters", () => {
    expect(coverChecks(withCover({ headline: "Veneto impugnata" })).map((finding) => finding.check)).toContain("cover_headline");
    expect(coverChecks(withCover({ headline: "Il governo impugna oggi la legge del Veneto sul fine vita" })).map((finding) => finding.check)).toContain("cover_headline");
  });

  it("refuses clickbait on the cover", () => {
    const checks = coverChecks(withCover({ headline: "Il governo impugna la legge shock" })).map((finding) => finding.check);
    expect(checks).toContain("cover_tone");
    expect(coverChecks(withCover({ headline: "Il governo impugna la legge?" })).map((finding) => finding.check)).toContain("cover_tone");
  });

  it("treats every cover finding as a blocker", () => {
    expect(coverChecks(withCover({ headline: "Veneto" })).every((finding) => finding.severity === "blocker")).toBe(true);
  });

  it("adds nothing for a version saved before covers existed", () => {
    const older = withoutCover();
    expect(coverChecks(older)).toEqual([]);
  });
});
