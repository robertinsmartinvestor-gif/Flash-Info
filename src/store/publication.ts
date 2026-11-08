import type { SupabaseClient } from "@supabase/supabase-js";
import type { PrivacyStatus } from "@/src/core/publication-policy";
import type { PublicationStore } from "@/src/distribution/publish";
import type { FinalizeItem, QueueItem } from "@/src/distribution/youtube";

export class SupabasePublicationStore implements PublicationStore {
  constructor(private readonly db: SupabaseClient) {}

  private async call<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.db.rpc(name, args);
    if (error) throw new Error(`${name}:${error.code}`);
    return data as T;
  }

  beginUpload(queueId: string) {
    return this.call<QueueItem | null>("begin_upload", { p_queue_id: queueId });
  }

  failUpload(queueId: string, error: string) {
    return this.call<void>("fail_upload", { p_queue_id: queueId, p_error: error });
  }

  registerUpload(queueId: string, videoId: string, privacy: PrivacyStatus) {
    return this.call<void>("register_youtube_upload", { p_queue_id: queueId, p_video_id: videoId, p_privacy: privacy });
  }

  recordVideo(queueId: string, videoId: string, privacy: PrivacyStatus) {
    return this.call<void>("record_youtube_video", { p_queue_id: queueId, p_video_id: videoId, p_privacy: privacy });
  }

  claimFinalize(queueId: string) {
    return this.call<FinalizeItem | null>("claim_finalize", { p_queue_id: queueId });
  }

  releaseFinalize(queueId: string, reason: string) {
    return this.call<void>("release_finalize", { p_queue_id: queueId, p_reason: reason });
  }

  failThumbnail(queueId: string, error: string) {
    return this.call<void>("fail_thumbnail", { p_queue_id: queueId, p_error: error });
  }

  confirmThumbnail(queueId: string) {
    return this.call<void>("confirm_thumbnail", { p_queue_id: queueId });
  }

  async download(storagePath: string): Promise<Uint8Array> {
    const { data, error } = await this.db.storage.from("media").download(storagePath);
    if (error) throw new Error("storage_download");
    return new Uint8Array(await data.arrayBuffer());
  }
}
