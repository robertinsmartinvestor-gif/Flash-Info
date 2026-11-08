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

// Findings the next draft must fix: every blocker, and the claims the verifier
// found only partly supported, which would otherwise hold the script for a person.
const needsFix = (finding: QcReport["findings"][number]) => finding.severity === "blocker" || finding.check === "verifier";

function feedbackFrom(report: QcReport): string[] {
  return report.findings
    .filter(needsFix)
    .map((finding) => (finding.sentence === undefined ? finding.message : `Frase ${finding.sentence + 1}: ${finding.message}`));
}

/**
 * Candidate to stored script versions. Every draft is saved, blocked ones too, so
 * the reasons stay readable. A blocked draft, or one with claims the verifier
 * found only partly supported, gets one corrected retry; if that fails as well
 * the script stays as it is for the editor, and spending stops.
 */
export async function runCompose(store: EditorialStore, router: AiRouter, candidateId: string, now = new Date()): Promise<ComposeResult> {
  const candidate = await store.getCandidate(candidateId);
  if (!candidate) throw new Error("candidate_not_found");
  if (candidate.status !== "selected") throw new Error(`candidate_not_selected:${candidate.status}`);
  if (candidate.hasScript) throw new Error("candidate_already_scripted");
  if (!(await store.claimCandidate(candidateId))) throw new Error("candidate_already_claimed");

  const format = FORMATS[candidate.format];
  const pack = buildEvidencePack(candidate.articles);

  let feedback: string[] = [];
  for (let attempt = 1; ; attempt += 1) {
    const { data: draft, route } = await generateDraft(router, pack, format.id, now, feedback);
    let report = runQualityChecks(draft, pack, format, now);
    // Spend on the semantic check only for drafts that passed the free ones.
    if (report.verdict !== "blocked") report = await verifyClaims(router, draft, pack, report);
    const retry = report.findings.some(needsFix) && attempt < MAX_DRAFTS;

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

    if (!retry) return { ...saved, verdict: report.verdict, findings: report.findings.length };
    feedback = feedbackFrom(report);
  }
}
