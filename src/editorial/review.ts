import type { QcFinding } from "@/src/quality/checks";
import { type EvidenceItem, type ScriptDraft, storedDraftSchema } from "./schema";

export interface ScriptRow {
  id: string;
  status: string;
  format: string;
  approved_version_id?: string | null;
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
  /** Every version of the script, oldest first: the pilot writes up to three attempts. */
  versions: ReviewItem[];
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

function toItem(script: ScriptRow, row: VersionRow): ReviewItem {
  const draft = storedDraftSchema.safeParse(row.content);
  return {
    scriptId: script.id,
    versionId: row.id,
    version: row.version,
    status: script.status,
    format: script.format,
    qcVerdict: row.qc_verdict,
    estimatedSeconds: Number(row.estimated_seconds),
    narration: row.narration,
    createdAt: row.created_at,
    draft: draft.success ? draft.data : null,
    evidence: Array.isArray(row.evidence) ? (row.evidence as EvidenceItem[]) : [],
    findings: findingsOf(row.qc_report),
    versions: [],
  };
}

/**
 * One row per script, with what still needs a person first. The version shown is the
 * approved one; otherwise the newest that is not blocked, because a later blocked
 * attempt must not hide an earlier one a person can still approve; otherwise the newest.
 */
export function buildReviewItems(scripts: ScriptRow[], versions: VersionRow[]): ReviewItem[] {
  const items: ReviewItem[] = [];
  for (const script of scripts) {
    const all = versions.filter((row) => row.script_id === script.id).sort((a, b) => a.version - b.version).map((row) => toItem(script, row));
    if (all.length === 0) continue;
    for (const entry of all) entry.versions = all;
    const newestFirst = [...all].reverse();
    const shown = all.find((entry) => entry.versionId === script.approved_version_id)
      ?? newestFirst.find((entry) => entry.qcVerdict !== "blocked")
      ?? newestFirst[0]!;
    items.push(shown);
  }
  const rank = (item: ReviewItem) => (STATUS_ORDER.indexOf(item.status) + 1 || STATUS_ORDER.length + 1);
  return items.sort((a, b) => rank(a) - rank(b) || b.createdAt.localeCompare(a.createdAt));
}

/**
 * A version can be approved when it is not blocked and the script is still open. A
 * script the pilot marked blocked stays open: approve_script_version accepts any
 * version that is not blocked, so a person can pick an earlier, reviewable attempt.
 */
export const canApprove = (item: ReviewItem) =>
  item.qcVerdict !== "blocked" && (item.status === "in_review" || item.status === "draft" || item.status === "blocked");
export const canReject = (item: ReviewItem) => item.status !== "rejected";
