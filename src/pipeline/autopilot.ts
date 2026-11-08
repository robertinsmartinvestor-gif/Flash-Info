/**
 * The steps a person used to take in the Studio, taken on a schedule. Every
 * decision (which story, whether a script may go out, public or not) is made by
 * database functions under the rules in app_settings.autopilot; this module only
 * calls them in order and reports what happened.
 */

export interface VersionInProduction {
  versionId: string;
  hasTtsJob: boolean;
  hasAudio: boolean;
  hasRenderJob: boolean;
  hasVideo: boolean;
  hasThumbnail: boolean;
  queued: boolean;
}

export interface AutopilotStore {
  enabled(): Promise<boolean>;
  selectCandidate(): Promise<string | null>;
  approveScript(scriptId: string): Promise<boolean>;
  /** Approved versions young enough for the autopilot, with what exists for each. */
  freshApprovedVersions(): Promise<VersionInProduction[]>;
  enqueueJob(versionId: string, kind: "tts" | "render"): Promise<void>;
  queuePublic(versionId: string): Promise<void>;
  /** Public, authorized items waiting for their upload, and items on YouTube still waiting for cover or visibility. */
  pendingPublicUploads(): Promise<string[]>;
}

export interface ComposeOutcome {
  scriptId: string;
  verdict: string;
}

export type EditorialReport =
  | { action: "disabled" | "no_candidate" }
  | { action: "composed"; candidateId: string; scriptId: string; verdict: string; approved: boolean };

/** One new story at most per run: pick, write, and approve it if the rules allow. */
export async function runEditorialStep(
  store: AutopilotStore,
  compose: (candidateId: string) => Promise<ComposeOutcome>,
): Promise<EditorialReport> {
  if (!(await store.enabled())) return { action: "disabled" };
  const candidateId = await store.selectCandidate();
  if (!candidateId) return { action: "no_candidate" };
  const { scriptId, verdict } = await compose(candidateId);
  const approved = verdict === "blocked" ? false : await store.approveScript(scriptId);
  return { action: "composed", candidateId, scriptId, verdict, approved };
}

export interface AdvanceReport {
  tts: number;
  render: number;
  published: number;
  /** Rendered versions with a video but no cover: they wait, they are never queued without one. */
  missingCover: number;
  errors: string[];
}

const errorClass = (error: unknown) => (error instanceof Error ? error.message : "error").replace(/[^\w .:-]/g, "").slice(0, 80);

/** Moves every fresh approved version one step further: audio, then video and cover, then the public queue. */
export async function runAdvanceStep(store: AutopilotStore): Promise<AdvanceReport> {
  const report: AdvanceReport = { tts: 0, render: 0, published: 0, missingCover: 0, errors: [] };
  if (!(await store.enabled())) return report;
  for (const version of await store.freshApprovedVersions()) {
    try {
      if (version.queued) continue;
      if (version.hasVideo && version.hasThumbnail) {
        await store.queuePublic(version.versionId);
        report.published += 1;
      } else if (version.hasVideo) {
        report.missingCover += 1;
      } else if (version.hasAudio) {
        if (!version.hasRenderJob) {
          await store.enqueueJob(version.versionId, "render");
          report.render += 1;
        }
      } else if (!version.hasTtsJob) {
        await store.enqueueJob(version.versionId, "tts");
        report.tts += 1;
      }
    } catch (error) {
      report.errors.push(errorClass(error));
    }
  }
  return report;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Ids for the upload loop in the workflow: only well-formed UUIDs reach the shell. */
export async function uploadIds(store: AutopilotStore): Promise<string[]> {
  if (!(await store.enabled())) return [];
  return (await store.pendingPublicUploads()).filter((id) => UUID.test(id));
}
