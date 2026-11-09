import type { QcReport } from "@/src/quality/checks";
import type { EvidenceItem, ScriptDraft } from "@/src/editorial/schema";
import type { FormatId } from "@/src/editorial/formats";
import type { Article, EventSnapshot, NewsSource, RankedEvent } from "@/src/news/types";
import type { UsageLedger } from "@/src/providers/types";

export interface FetchStatus {
  etag: string | null;
  lastModified: string | null;
  status: string;
  failed: boolean;
}

export interface CandidateBundle {
  id: string;
  status: string;
  format: FormatId;
  eventId: string;
  articles: Article[];
  hasScript: boolean;
}

export interface ScriptVersionInput {
  candidateId: string;
  format: FormatId;
  draft: ScriptDraft;
  narration: string;
  wordCount: number;
  report: QcReport;
  evidence: EvidenceItem[];
  youtubeMetadata: unknown;
  provider: string;
  model: string;
}

export interface IngestRun {
  sourcesTotal: number;
  sourcesFailed: number;
  itemsSeen: number;
  droppedUndated: number;
  droppedOutOfWindow: number;
  droppedBadUrl: number;
  droppedDuplicate: number;
  alreadyStored: number;
  newArticles: number;
  eventsSaved: number;
  candidates: number;
}

export interface EditorialStore extends UsageLedger {
  listSources(): Promise<NewsSource[]>;
  recordFetch(sourceId: string, status: FetchStatus): Promise<void>;
  /** Stores the counters of one ingest run, including what was dropped before saving. */
  recordIngestRun(run: IngestRun): Promise<void>;
  /** Inserts what is new, ignoring known URLs, and returns only the new rows. */
  insertArticles(articles: Article[]): Promise<Article[]>;
  loadRecentEvents(sinceIso: string): Promise<EventSnapshot[]>;
  /** Creates or updates the event and links articles idempotently. Returns the event id. */
  saveEvent(event: RankedEvent): Promise<string>;
  upsertCandidate(eventId: string, event: RankedEvent, format: FormatId): Promise<void>;
  getCandidate(candidateId: string): Promise<CandidateBundle | null>;
  /** Atomically moves a selected candidate to composing. False if another run has it. */
  claimCandidate(candidateId: string): Promise<boolean>;
  saveScriptVersion(input: ScriptVersionInput): Promise<{ scriptId: string; version: number }>;
}
