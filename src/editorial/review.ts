import type { QcFinding } from "@/src/quality/checks";
import { type EvidenceItem, type ScriptDraft, scriptDraftSchema } from "./schema";

export interface ScriptRow {
  id: string;
  status: string;
  format: string;
}

export interface VersionRow {
  id: string;
  script_id: string;
  version: number;
  content: unknown;
  narration: string;
  estimated_seconds: number;
  evidence: unknown;
  qc_verdict: string;
  qc_report: unknown;
  created_at: string;
}

export interface ReviewItem {
  scriptId: string;
  versionId: string;
  version: number;
  status: string;
  format: string;
  qcVerdict: string;
  estimatedSeconds: number;
  narration: string;
  createdAt: string;
  /** Null when the stored content no longer matches the schema: the narration still shows. */
  draft: ScriptDraft | null;
  evidence: EvidenceItem[];
  findings: QcFinding[];
}

const STATUS_ORDER = ["in_review", "draft", "blocked", "approved", "rejected"];

/** Feed URLs are untrusted: only https links reach the page, so `javascript:` never does. */
export function safeHttpsUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function findingsOf(report: unknown): QcFinding[] {
  const findings = (report as { findings?: unknown } | null)?.findings;
  return Array.isArray(findings) ? (findings as QcFinding[]) : [];
}

/** One row per script, on its latest version, with what still needs a person first. */
export function buildReviewItems(scripts: ScriptRow[], versions: VersionRow[]): ReviewItem[] {
  const items: ReviewItem[] = [];
  for (const script of scripts) {
    const latest = versions.filter((row) => row.script_id === script.id).sort((a, b) => b.version - a.version)[0];
    if (!latest) continue;
    const draft = scriptDraftSchema.safeParse(latest.content);
    items.push({
      scriptId: script.id,
      versionId: latest.id,
      version: latest.version,
      status: script.status,
      format: script.format,
      qcVerdict: latest.qc_verdict,
      estimatedSeconds: Number(latest.estimated_seconds),
      narration: latest.narration,
      createdAt: latest.created_at,
      draft: draft.success ? draft.data : null,
      evidence: Array.isArray(latest.evidence) ? (latest.evidence as EvidenceItem[]) : [],
      findings: findingsOf(latest.qc_report),
    });
  }
  const rank = (item: ReviewItem) => (STATUS_ORDER.indexOf(item.status) + 1 || STATUS_ORDER.length + 1);
  return items.sort((a, b) => rank(a) - rank(b) || b.createdAt.localeCompare(a.createdAt));
}

export const canApprove = (item: ReviewItem) => item.qcVerdict !== "blocked" && (item.status === "in_review" || item.status === "draft");
export const canReject = (item: ReviewItem) => item.status !== "rejected";
