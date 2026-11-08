import { createReadStream } from "node:fs";
import { google } from "googleapis";
import { decideUpload, type PrivacyStatus, type PublicationConfig } from "@/src/core/publication-policy";

export interface QueueItem {
  id: string;
  privacy: PrivacyStatus;
  publish_at: string | null;
  contains_synthetic_media: boolean;
  title: string;
  description: string;
  tags: string[];
  public_authorized_by: string | null;
  public_authorized_at: string | null;
  storage_path: string | null;
  script_approved: boolean;
  /** Set on items queued with a cover; null on items queued before covers existed. */
  thumbnail_asset_id?: string | null;
  thumbnail_path?: string | null;
}

/** An item already on YouTube, waiting for its cover or its final visibility. */
export interface FinalizeItem extends QueueItem {
  youtube_video_id: string;
  thumbnail_status: "pending" | "set" | "failed" | null;
  thumbnail_attempts: number;
}

export interface VideoStatus {
  privacyStatus: PrivacyStatus;
  publishAt?: string;
  selfDeclaredMadeForKids: boolean;
  containsSyntheticMedia: boolean;
}

export interface InsertRequest {
  part: string[];
  notifySubscribers: boolean;
  requestBody: {
    snippet: { title: string; description: string; tags: string[]; categoryId: string; defaultLanguage: string; defaultAudioLanguage: string };
    status: VideoStatus;
  };
}

export class UploadRefusedError extends Error {
  constructor(reason: string) {
    super(`upload_refused:${reason}`);
    this.name = "UploadRefusedError";
  }
}

// An authorization from the autopilot has a time but no user behind it.
function decide(config: PublicationConfig, item: QueueItem) {
  const authorization = item.public_authorized_at
    ? { authorizedBy: item.public_authorized_by ?? "autopilot", authorizedAt: item.public_authorized_at }
    : null;
  const decision = decideUpload(config, { requestedPrivacy: item.privacy, scriptApproved: item.script_approved, publicAuthorization: authorization });
  if (!decision.allowed) throw new UploadRefusedError(decision.reason);
  return decision.privacy;
}

/**
 * The visibility the policy allows for this item, from decideUpload() only.
 *
 * A private video with publishAt becomes public on its own at that time, so a
 * schedule counts as a public publication: without authorization it is dropped
 * and the video simply stays private. For the same reason an authorized public
 * video with a future date is sent as private plus publishAt, the only form
 * YouTube accepts. A date already past means public now: never earlier than asked.
 */
export function finalVisibility(config: PublicationConfig, item: QueueItem, now: Date): VideoStatus {
  const privacy = decide(config, item);
  const scheduled = privacy === "public" && item.publish_at !== null && Date.parse(item.publish_at) > now.getTime();
  return {
    privacyStatus: scheduled ? "private" : privacy,
    ...(scheduled ? { publishAt: item.publish_at! } : {}),
    selfDeclaredMadeForKids: false,
    containsSyntheticMedia: item.contains_synthetic_media,
  };
}

/** What the queue records once the final visibility is applied: a schedule counts as public. */
export function recordedPrivacy(status: VideoStatus): PrivacyStatus {
  return status.publishAt ? "public" : status.privacyStatus;
}

/**
 * Builds the insert request after applying the publication policy. An item with
 * a cover is always inserted private, without publishAt: it changes visibility
 * only after the API confirms the cover (see publishQueueItem). Items queued
 * before covers existed keep the old single step.
 */
export function buildInsertRequest(config: PublicationConfig, item: QueueItem, now = new Date()): InsertRequest {
  const final = finalVisibility(config, item, now);
  const withCover = Boolean(item.thumbnail_asset_id);
  const status: VideoStatus = withCover
    ? { privacyStatus: "private", selfDeclaredMadeForKids: false, containsSyntheticMedia: item.contains_synthetic_media }
    : final;
  return {
    part: ["snippet", "status"],
    // Only read by YouTube at insert time: a video made public later notifies nobody.
    notifySubscribers: !withCover && recordedPrivacy(final) === "public",
    requestBody: {
      snippet: {
        title: item.title,
        description: item.description,
        tags: item.tags,
        categoryId: "25",
        defaultLanguage: "it",
        defaultAudioLanguage: "it",
      },
      status,
    },
  };
}

export interface YoutubeCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

/** Scopes that allow videos.list on processing details, thumbnails.set and videos.update. */
export const FINALIZE_SCOPES = ["https://www.googleapis.com/auth/youtube", "https://www.googleapis.com/auth/youtube.force-ssl"];

export type ProcessingStatus = "processing" | "succeeded" | "failed" | "terminated" | "missing";

/** The YouTube calls the publication needs, behind an interface so the flow can be tested without the network. */
export interface YoutubeApi {
  grantedScopes(): Promise<string[]>;
  insert(request: InsertRequest, videoPath: string): Promise<string>;
  processingStatus(videoId: string): Promise<ProcessingStatus>;
  /** True only when the API answered with the new thumbnail. */
  setThumbnail(videoId: string, pngPath: string): Promise<boolean>;
  updateStatus(videoId: string, status: VideoStatus): Promise<void>;
}

/** A short, public-log-safe code for an API error: HTTP status and Google's reason, never a message body. */
export function apiErrorCode(prefix: string, error: unknown): string {
  const status = (error as { code?: unknown; status?: unknown }).code ?? (error as { status?: unknown }).status;
  const reason = (error as { errors?: Array<{ reason?: unknown }> }).errors?.[0]?.reason;
  const clean = (value: unknown) => String(value ?? "").replace(/[^\w.-]/g, "").slice(0, 40);
  return [prefix, clean(status), clean(reason)].filter(Boolean).join(":");
}

export function createYoutubeApi(credentials: YoutubeCredentials): YoutubeApi {
  const auth = new google.auth.OAuth2(credentials.clientId, credentials.clientSecret);
  auth.setCredentials({ refresh_token: credentials.refreshToken });
  const youtube = google.youtube({ version: "v3", auth });

  return {
    async grantedScopes() {
      const { token } = await auth.getAccessToken();
      if (!token) return [];
      return (await auth.getTokenInfo(token)).scopes ?? [];
    },
    async insert(request, videoPath) {
      const response = await youtube.videos.insert({ ...request, media: { mimeType: "video/mp4", body: createReadStream(videoPath) } });
      if (!response.data.id) throw new Error("youtube_no_video_id");
      return response.data.id;
    },
    async processingStatus(videoId) {
      const response = await youtube.videos.list({ part: ["processingDetails"], id: [videoId] });
      const video = response.data.items?.[0];
      if (!video) return "missing";
      const status = video.processingDetails?.processingStatus;
      return status === "succeeded" || status === "failed" || status === "terminated" ? status : "processing";
    },
    async setThumbnail(videoId, pngPath) {
      const response = await youtube.thumbnails.set({ videoId, media: { mimeType: "image/png", body: createReadStream(pngPath) } });
      return (response.data.items?.length ?? 0) > 0;
    },
    async updateStatus(videoId, status) {
      // part=status replaces the whole status: every field we rely on is sent again.
      await youtube.videos.update({ part: ["status"], requestBody: { id: videoId, status } });
    },
  };
}
