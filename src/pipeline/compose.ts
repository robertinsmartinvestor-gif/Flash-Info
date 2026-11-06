import { wordCount } from "@/src/core/text";
import { FORMATS } from "@/src/editorial/formats";
import { buildEvidencePack, buildYoutubeMetadata, draftNarration, generateDraft } from "@/src/editorial/generate";
import type { AiRouter } from "@/src/providers/router";
import { runQualityChecks, type QcReport } from "@/src/quality/checks";
import { verifyClaims } from "@/src/quality/verifier";
import type { EditorialStore } from "@/src/store/types";

const MAX_DRAFTS = 2;

export interface ComposeResult {
  scriptId: string;
  version: number;
  verdict: QcReport["verdict"];
  findings: number;
}

function feedbackFrom(report: QcReport): string[] {
  return report.findings
    .filter((finding) => finding.severity === "blocker")
    .map((finding) => (finding.sentence === undefined ? finding.message : `Frase ${finding.sentence + 1}: ${finding.message}`));
}

/**
 * Candidate to stored script version. A blocked draft gets one corrected retry;
 * if it still fails it is stored as blocked for the editor, so the failure is
 * visible and generation cannot loop on spend.
 */
export async function runCompose(store: EditorialStore, router: AiRouter, candidateId: string, now = new Date()): Promise<ComposeResult> {
  const candidate = await store.getCandidate(candidateId);
  if (!candidate) throw new Error("candidate_not_found");
  if (candidate.status !== "selected") throw new Error(`candidate_not_selected:${candidate.status}`);
  if (candidate.hasScript) throw new Error("candidate_already_scripted");

  const format = FORMATS[candidate.format];
  const pack = buildEvidencePack(candidate.articles);

  let feedback: string[] = [];
  for (let attempt = 1; ; attempt += 1) {
    const { data: draft, route } = await generateDraft(router, pack, format.id, now, feedback);
    let report = runQualityChecks(draft, pack, format, now);

    if (report.verdict === "blocked" && attempt < MAX_DRAFTS) {
      feedback = feedbackFrom(report);
      continue;
    }
    // Spend on the semantic check only for drafts that passed the free ones.
    if (report.verdict !== "blocked") report = await verifyClaims(router, draft, pack, report);

    const narration = draftNarration(draft);
    const saved = await store.saveScriptVersion({
      candidateId,
      format: format.id,
      draft,
      narration,
      wordCount: wordCount(narration),
      report,
      evidence: pack,
      youtubeMetadata: buildYoutubeMetadata(draft, pack),
      provider: route.provider,
      model: route.model,
    });
    return { ...saved, verdict: report.verdict, findings: report.findings.length };
  }
}
