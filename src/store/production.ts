import type { SupabaseClient } from "@supabase/supabase-js";
import type { AudioAsset, ClaimedTtsJob, ProductionStore, VersionToRead } from "@/src/pipeline/tts-job";

const DEFAULT_PREVIEW_DAYS = 14;

export class SupabaseProductionStore implements ProductionStore {
  constructor(private readonly db: SupabaseClient) {}

  async queuedTtsJobIds(limit: number): Promise<string[]> {
    const { data, error } = await this.db
      .from("production_jobs")
      .select("id")
      .eq("kind", "tts")
      .eq("status", "queued")
      .order("created_at")
      .limit(limit);
    if (error) throw new Error(`jobs:${error.code}`);
    return data.map((row) => row.id as string);
  }

  async claimJob(jobId: string, runnerId: string): Promise<ClaimedTtsJob | null> {
    const { data, error } = await this.db.rpc("claim_job", { p_job_id: jobId, p_runner_id: runnerId });
    if (error) throw new Error(`claim:${error.code}`);
    const row = data as { id: string | null; script_version_id: string | null } | null;
    return row?.id && row.script_version_id ? { id: row.id, scriptVersionId: row.script_version_id } : null;
  }

  async loadVersion(versionId: string): Promise<VersionToRead | null> {
    const version = await this.db.from("script_versions").select("script_id, narration").eq("id", versionId).maybeSingle();
    if (version.error) throw new Error(`version:${version.error.code}`);
    if (!version.data) return null;
    const script = await this.db.from("scripts").select("status, approved_version_id").eq("id", version.data.script_id).maybeSingle();
    if (script.error) throw new Error(`script:${script.error.code}`);
    return {
      scriptId: version.data.script_id as string,
      narration: version.data.narration as string,
      approved: script.data?.status === "approved" && script.data.approved_version_id === versionId,
    };
  }

  private async setting(key: string): Promise<unknown> {
    const { data, error } = await this.db.from("app_settings").select("value").eq("key", key).maybeSingle();
    if (error) throw new Error(`setting:${error.code}`);
    return data?.value;
  }

  loadVoiceSetting(): Promise<unknown> {
    return this.setting("tts_voice");
  }

  async loadPreviewRetentionDays(): Promise<number> {
    const days = Number((await this.setting("retention_days") as { media_preview?: unknown } | undefined)?.media_preview);
    return Number.isFinite(days) && days > 0 ? days : DEFAULT_PREVIEW_DAYS;
  }

  async monthlySpendUsd(): Promise<number> {
    const { data, error } = await this.db.rpc("provider_spend_usd");
    if (error) throw new Error(`spend:${error.code}`);
    return Number(data);
  }

  async saveAudio(path: string, audio: Uint8Array): Promise<void> {
    // upsert: a rerun of the same version overwrites its own file.
    const { error } = await this.db.storage.from("media").upload(path, audio, { contentType: "audio/mpeg", upsert: true });
    if (error) throw new Error("tts_storage_upload");
  }

  async recordAsset(asset: AudioAsset): Promise<string> {
    const { data, error } = await this.db
      .from("media_assets")
      .upsert(
        {
          script_version_id: asset.scriptVersionId,
          job_id: asset.jobId,
          kind: "audio",
          storage_path: asset.storagePath,
          mime_type: "audio/mpeg",
          size_bytes: asset.sizeBytes,
          sha256: asset.sha256,
          rights: asset.rights,
          expires_at: asset.expiresAt,
          deleted_at: null,
        },
        { onConflict: "storage_bucket,storage_path" },
      )
      .select("id")
      .single();
    if (error) throw new Error(`asset:${error.code}`);
    return data.id as string;
  }

  async recordUsage(usage: { provider: string; voice: string; characters: number; costUsd: number; scriptId: string }): Promise<void> {
    const { error } = await this.db.from("provider_usage").insert({
      provider: usage.provider,
      feature: "tts",
      model: usage.voice,
      characters: usage.characters,
      estimated_cost_usd: usage.costUsd,
      success: true,
      script_id: usage.scriptId,
    });
    if (error) throw new Error(`usage:${error.code}`);
  }

  async finishJob(jobId: string, outcome: { status: "succeeded"; result: Record<string, unknown> } | { status: "failed"; errorCode: string }): Promise<void> {
    const { error } = await this.db.rpc("finish_job", {
      p_job_id: jobId,
      p_status: outcome.status,
      p_result: outcome.status === "succeeded" ? outcome.result : {},
      p_error_code: outcome.status === "failed" ? outcome.errorCode : null,
    });
    if (error) throw new Error(`finish:${error.code}`);
  }
}
