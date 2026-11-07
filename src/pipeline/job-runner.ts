export type JobKind = "tts" | "render";

export interface ClaimedJob {
  id: string;
  scriptVersionId: string;
}

export type JobResult = { status: "succeeded"; result: Record<string, unknown> } | { status: "failed"; errorCode: string };

export interface JobQueue {
  queuedJobIds(kind: JobKind, limit: number): Promise<string[]>;
  /** Null when another runner has it or it is no longer queued. */
  claimJob(jobId: string, runnerId: string): Promise<ClaimedJob | null>;
  finishJob(jobId: string, outcome: JobResult): Promise<void>;
}

export type JobOutcome = { jobId: string; status: "skipped" | "succeeded" } | { jobId: string; status: "failed"; errorCode: string };

export interface JobRunOptions {
  kind: JobKind;
  runnerId: string;
  /** Only codes matching this reach the public log and the database. */
  knownError: RegExp;
  fallbackError: string;
}

const MAX_JOBS_PER_RUN = 3;

/** Takes the queued jobs of one kind. One failing does not stop the next, and each ends with a recorded state. */
export async function runQueuedJobs(
  queue: JobQueue,
  options: JobRunOptions,
  produce: (job: ClaimedJob) => Promise<Record<string, unknown>>,
): Promise<JobOutcome[]> {
  const outcomes: JobOutcome[] = [];
  for (const jobId of await queue.queuedJobIds(options.kind, MAX_JOBS_PER_RUN)) {
    const job = await queue.claimJob(jobId, options.runnerId);
    if (!job) {
      outcomes.push({ jobId, status: "skipped" });
      continue;
    }
    try {
      const result = await produce(job);
      await queue.finishJob(job.id, { status: "succeeded", result });
      outcomes.push({ jobId, status: "succeeded" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const errorCode = options.knownError.test(message) ? message : options.fallbackError;
      await queue.finishJob(job.id, { status: "failed", errorCode });
      outcomes.push({ jobId, status: "failed", errorCode });
    }
  }
  return outcomes;
}
