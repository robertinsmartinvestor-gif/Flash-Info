import type { SupabaseClient } from "@supabase/supabase-js";
import type { AutopilotStore, VersionInProduction } from "@/src/pipeline/autopilot";

interface Settings {
  enabled?: boolean;
  max_age_hours?: number;
}

export class SupabaseAutopilotStore implements AutopilotStore {
  constructor(private readonly client: SupabaseClient) {}

  private async settings(): Promise<Settings> {
    const { data, error } = await this.client.from("app_settings").select("value").eq("key", "autopilot").maybeSingle();
    if (error) throw new Error("autopilot_settings");
    return (data?.value ?? {}) as Settings;
  }

  async enabled(): Promise<boolean> {
    return (await this.settings()).enabled === true;
  }

  async selectCandidate(): Promise<string | null> {
    const { data, error } = await this.client.rpc("autopilot_select_candidate");
    if (error) throw new Error(`autopilot_select:${error.code}`);
    return (data as string | null) ?? null;
  }

  async approveScript(scriptId: string): Promise<boolean> {
    const { data, error } = await this.client.rpc("autopilot_approve_script", { p_script_id: scriptId });
    if (error) throw new Error(`autopilot_approve:${error.code}`);
    return data === true;
  }

  async freshApprovedVersions(): Promise<VersionInProduction[]> {
    const hours = (await this.settings()).max_age_hours ?? 24;
    const since = new Date(Date.now() - hours * 3600_000).toISOString();
    const scripts = await this.client.from("scripts").select("approved_version_id").eq("status", "approved").not("approved_version_id", "is", null).limit(100);
    if (scripts.error) throw new Error("autopilot_scripts");
    const approved = scripts.data.map((row) => row.approved_version_id as string);
    if (approved.length === 0) return [];

    const [versions, jobs, assets, queue] = await Promise.all([
      this.client.from("script_versions").select("id").in("id", approved).gt("created_at", since),
      this.client.from("production_jobs").select("script_version_id, kind").in("script_version_id", approved),
      this.client.from("media_assets").select("script_version_id, kind").in("script_version_id", approved).in("kind", ["audio", "video", "thumbnail"]).is("deleted_at", null),
      this.client.from("publication_queue").select("script_version_id").in("script_version_id", approved),
    ]);
    if (versions.error || jobs.error || assets.error || queue.error) throw new Error("autopilot_state");

    const has = (rows: Array<Record<string, unknown>>, id: string, kind?: string) =>
      rows.some((row) => row.script_version_id === id && (kind === undefined || row.kind === kind));
    return versions.data.map(({ id }) => ({
      versionId: id as string,
      hasTtsJob: has(jobs.data, id, "tts"),
      hasRenderJob: has(jobs.data, id, "render"),
      hasAudio: has(assets.data, id, "audio"),
      hasVideo: has(assets.data, id, "video"),
      hasThumbnail: has(assets.data, id, "thumbnail"),
      queued: has(queue.data, id),
    }));
  }

  async enqueueJob(versionId: string, kind: "tts" | "render"): Promise<void> {
    const { error } = await this.client.rpc("autopilot_enqueue_job", { p_version_id: versionId, p_kind: kind });
    if (error) throw new Error(`autopilot_enqueue_${kind}:${error.code}`);
  }

  async queuePublic(versionId: string): Promise<void> {
    const { error } = await this.client.rpc("autopilot_queue_public", { p_version_id: versionId });
    if (error) throw new Error(`autopilot_queue:${error.code}`);
  }

  async pendingPublicUploads(): Promise<string[]> {
    const { data, error } = await this.client
      .from("publication_queue")
      .select("id")
      // New public uploads, and items already on YouTube that still need their cover.
      .or("and(status.eq.pending,privacy.eq.public,public_authorized_at.not.is.null),status.eq.processing,status.eq.finalizing")
      .lt("thumbnail_attempts", 5)
      .order("created_at")
      .limit(5);
    if (error) throw new Error("autopilot_uploads");
    return data.map((row) => row.id as string);
  }
}
