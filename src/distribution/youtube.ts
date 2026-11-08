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
}

export interface InsertRequest {
  part: string[];
  notifySubscribers: boolean;
  requestBody: {
    snippet: { title: string; description: string; tags: string[]; categoryId: string; defaultLanguage: string; defaultAudioLanguage: string };
    status: { privacyStatus: PrivacyStatus; publishAt?: string; selfDeclaredMadeForKids: boolean; containsSyntheticMedia: boolean };
  };
}

export class UploadRefusedError extends Error {
  constructor(reason: string) {
    super(`upload_refused:${reason}`);
    this.name = "UploadRefusedError";
  }
}

/**
 * Builds the request after applying the publication policy.
 *
 * A private video with publishAt becomes public on its own at that time, so a
 * schedule counts as a public publication: without authorization it is dropped
 * and the video simply stays private. For the same reason an authorized public
 * video with a date is sent as private plus publishAt, the only form YouTube accepts.
 */
export function buildInsertRequest(config: PublicationConfig, item: QueueItem): InsertRequest {
  // An authorization from the autopilot has a time but no user behind it.
  const authorization = item.public_authorized_at
    ? { authorizedBy: item.public_authorized_by ?? "autopilot", authorizedAt: item.public_authorized_at }
    : null;
  const decision = decideUpload(config, { requestedPrivacy: item.privacy, scriptApproved: item.script_approved, publicAuthorization: authorization });
  if (!decision.allowed) throw new UploadRefusedError(decision.reason);

  const scheduled = decision.privacy === "public" && item.publish_at !== null;
  return {
    part: ["snippet", "status"],
    notifySubscribers: decision.privacy === "public",
    requestBody: {
      snippet: {
        title: item.title,
        description: item.description,
        tags: item.tags,
        categoryId: "25",
        defaultLanguage: "it",
        defaultAudioLanguage: "it",
      },
      status: {
        privacyStatus: scheduled ? "private" : decision.privacy,
        ...(scheduled ? { publishAt: item.publish_at! } : {}),
        selfDeclaredMadeForKids: false,
        containsSyntheticMedia: item.contains_synthetic_media,
      },
    },
  };
}

export interface YoutubeCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export async function uploadVideo(credentials: YoutubeCredentials, request: InsertRequest, videoPath: string): Promise<string> {
  const auth = new google.auth.OAuth2(credentials.clientId, credentials.clientSecret);
  auth.setCredentials({ refresh_token: credentials.refreshToken });
  const youtube = google.youtube({ version: "v3", auth });
  const response = await youtube.videos.insert({
    ...request,
    media: { mimeType: "video/mp4", body: createReadStream(videoPath) },
  });
  if (!response.data.id) throw new Error("youtube_no_video_id");
  return response.data.id;
}
