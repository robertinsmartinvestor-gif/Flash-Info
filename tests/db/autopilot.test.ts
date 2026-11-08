import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asRole, createDatabase } from "../helpers/database";

let db: PGlite;
type Row = Record<string, unknown>;

async function one(sql: string, params: unknown[] = []): Promise<Row> {
  const row = (await db.query<Row>(sql, params)).rows[0];
  if (!row) throw new Error("expected a row");
  return row;
}

const service = <T>(fn: () => Promise<T>) => asRole(db, "service_role", null, fn);
const rpc = (sql: string, params: unknown[] = []) => service(() => one(sql, params));

const META = { title: "Titolo", description: "Fonti: ANSA", tags: ["news"] };

async function candidate({ score = 50, hoursAgo = 1 } = {}) {
  const event = await one(`insert into news_events (title) values ('e') returning id`);
  return (await one(
    `insert into editorial_candidates (event_id, format, score, created_at) values ($1, 'flash', $2, now() - make_interval(hours => $3)) returning id`,
    [event.id, score, hoursAgo],
  )).id as string;
}

async function script({ verdict = "needs_review", findings = [] as Array<{ check: string; severity: string }>, hoursAgo = 1 } = {}) {
  const candidateId = await candidate();
  const s = await one(`insert into scripts (candidate_id, format, status) values ($1, 'flash', $2) returning id`, [candidateId, verdict === "blocked" ? "blocked" : "in_review"]);
  const v = await one(
    `insert into script_versions (script_id, version, content, narration, word_count, estimated_seconds, qc_verdict, qc_report, youtube_metadata, created_at)
     values ($1, 1, '{}', 't', 1, 1, $2, $3, $4, now() - make_interval(hours => $5)) returning id`,
    [s.id, verdict, JSON.stringify({ verdict, findings }), JSON.stringify(META), hoursAgo],
  );
  return { scriptId: s.id as string, versionId: v.id as string };
}

async function addVideo(versionId: string) {
  await db.query(`insert into media_assets (script_version_id, kind, storage_path, mime_type, size_bytes) values ($1, 'video', $2, 'video/mp4', 1), ($1, 'thumbnail', $2 || '.png', 'image/png', 1)`, [versionId, `video/${randomUUID()}.mp4`]);
}

beforeAll(async () => {
  db = await createDatabase();
});

beforeEach(async () => {
  await db.exec(`
    set session_replication_role = replica;
    delete from audit_logs; delete from youtube_publications; delete from publication_queue; delete from media_assets;
    delete from production_jobs; update scripts set approved_version_id = null; delete from script_versions; delete from scripts;
    delete from editorial_candidates; delete from news_events;
    set session_replication_role = origin;
    update app_settings set value = jsonb_set(value, '{enabled}', 'true') where key = 'autopilot';
    update app_settings set value = value || jsonb_build_object('publish_hours', (select jsonb_agg(lpad(h::text, 2, '0')) from generate_series(0, 23) h)) where key = 'autopilot';
  `);
});

describe("autopilot_select_candidate", () => {
  it("takes the best fresh candidate and writes a system audit row", async () => {
    await candidate({ score: 40 });
    const best = await candidate({ score: 80 });
    await candidate({ score: 99, hoursAgo: 30 });
    expect((await rpc("select autopilot_select_candidate() as id")).id).toBe(best);
    expect((await one("select status from editorial_candidates where id = $1", [best])).status).toBe("selected");
    expect((await one("select actor_type from audit_logs where action = 'candidate.auto_selected'")).actor_type).toBe("system");
  });

  it("waits for the gap between stories and stops at the daily cap", async () => {
    await candidate();
    await candidate();
    expect((await rpc("select autopilot_select_candidate() as id")).id).not.toBeNull();
    expect((await rpc("select autopilot_select_candidate() as id")).id).toBeNull();
    await db.query("update app_settings set value = value || '{\"min_gap_hours\": 0, \"max_stories_per_day\": 1}' where key = 'autopilot'");
    expect((await rpc("select autopilot_select_candidate() as id")).id).toBeNull();
    await db.query("update app_settings set value = value || '{\"min_gap_hours\": 3, \"max_stories_per_day\": 3}' where key = 'autopilot'");
  });

  it("refuses everything when switched off, and is closed to the Studio roles", async () => {
    await db.query("update app_settings set value = jsonb_set(value, '{enabled}', 'false') where key = 'autopilot'");
    await expect(rpc("select autopilot_select_candidate()")).rejects.toThrow("autopilot is disabled");
    await expect(asRole(db, "authenticated", randomUUID(), () => db.query("select autopilot_select_candidate()"))).rejects.toThrow("permission denied");
    await expect(asRole(db, "anon", null, () => db.query("select autopilot_queue_public($1)", [randomUUID()]))).rejects.toThrow("permission denied");
  });
});

describe("autopilot_approve_script", () => {
  it("approves a fresh script with style warnings only", async () => {
    const { scriptId, versionId } = await script({ findings: [{ check: "repetition", severity: "warning" }] });
    expect((await rpc("select autopilot_approve_script($1) as ok", [scriptId])).ok).toBe(true);
    expect(await one("select status, approved_version_id from scripts where id = $1", [scriptId])).toEqual({ status: "approved", approved_version_id: versionId });
  });

  it("holds scripts with unverified claims or sensitive topics for a person", async () => {
    for (const check of ["verifier", "verifier_unavailable", "sensitive_topic"]) {
      const { scriptId } = await script({ findings: [{ check, severity: "warning" }] });
      expect((await rpc("select autopilot_approve_script($1) as ok", [scriptId])).ok).toBe(false);
      expect((await one("select status from scripts where id = $1", [scriptId])).status).toBe("in_review");
    }
    expect((await one("select count(*)::int as n from audit_logs where action = 'script.auto_held'")).n).toBe(3);
  });

  it("never approves blocked or stale scripts", async () => {
    const blocked = await script({ verdict: "blocked", findings: [{ check: "too_few_sources", severity: "blocker" }] });
    const stale = await script({ hoursAgo: 30 });
    expect((await rpc("select autopilot_approve_script($1) as ok", [blocked.scriptId])).ok).toBe(false);
    expect((await rpc("select autopilot_approve_script($1) as ok", [stale.scriptId])).ok).toBe(false);
  });
});

describe("autopilot production and publication", () => {
  async function approved(hoursAgo = 1) {
    const s = await script({ hoursAgo });
    await db.query("update scripts set status = 'approved', approved_version_id = $1 where id = $2", [s.versionId, s.scriptId]);
    return s.versionId;
  }

  it("queues jobs for fresh approved versions within the shared limits", async () => {
    const versionId = await approved();
    const first = await rpc("select autopilot_enqueue_job($1, 'tts') as id", [versionId]);
    expect((await rpc("select autopilot_enqueue_job($1, 'tts') as id", [versionId])).id).toBe(first.id);
    await expect(rpc("select autopilot_enqueue_job($1, 'distribution')", [versionId])).rejects.toThrow("invalid kind");
    await expect(rpc("select autopilot_enqueue_job($1, 'tts')", [await approved(30)])).rejects.toThrow("too old");
  });

  it("queues the video as public and authorized by the autopilot, which the upload guard accepts", async () => {
    const versionId = await approved();
    await addVideo(versionId);
    const { id } = await rpc("select autopilot_queue_public($1) as id", [versionId]);
    const row = await one("select privacy, public_authorized_by, public_authorized_at, public_authorized_policy, status from publication_queue where id = $1", [id]);
    expect(row).toMatchObject({ privacy: "public", public_authorized_by: null, public_authorized_policy: "autopilot", status: "pending" });
    expect(row.public_authorized_at).not.toBeNull();
    expect((await one("select data from audit_logs where action = 'publication.public_authorized'")).data).toEqual({ by: "autopilot" });

    await service(() => db.query("select begin_upload($1)", [id]));
    await service(() => db.query("select register_youtube_upload($1, 'abcdefghijk', 'public')", [id]));
    expect((await one("select status from publication_queue where id = $1", [id])).status).toBe("uploaded");
  });

  it("refuses versions without a video or not approved", async () => {
    await expect(rpc("select autopilot_queue_public($1)", [await approved()])).rejects.toThrow("no rendered video");
    const pending = await script();
    await expect(rpc("select autopilot_queue_public($1)", [pending.versionId])).rejects.toThrow("only approved");
  });
});

describe("public_requires_authorization", () => {
  it("still refuses a public row with no approver", async () => {
    const s = await script();
    await db.query("update scripts set status = 'approved', approved_version_id = $1 where id = $2", [s.versionId, s.scriptId]);
    await addVideo(s.versionId);
    const { id } = await rpc("select autopilot_queue_public($1) as id", [s.versionId]);
    await expect(db.query("update publication_queue set public_authorized_policy = null where id = $1", [id])).rejects.toThrow("public_requires_authorization");
  });
});

describe("publish hours", () => {
  const romeHour = async () => (await one("select to_char(now() at time zone 'Europe/Rome', 'HH24') as h")).h as string;
  const setHours = (hours: string[]) => db.query("update app_settings set value = value || jsonb_build_object('publish_hours', $1::jsonb) where key = 'autopilot'", [JSON.stringify(hours)]);

  it("picks a new story only in the listed hours, Rome time", async () => {
    await candidate();
    const now = await romeHour();
    const other = String((Number(now) + 1) % 24).padStart(2, "0");
    await setHours([other]);
    expect((await rpc("select autopilot_select_candidate() as id")).id).toBeNull();
    await setHours([now]);
    expect((await rpc("select autopilot_select_candidate() as id")).id).not.toBeNull();
  });

  it("picks nothing with no hour selected", async () => {
    await candidate();
    await setHours([]);
    expect((await rpc("select autopilot_select_candidate() as id")).id).toBeNull();
  });

  it("is editable from the Studio within the allowed hours", async () => {
    const field = await one("select options from setting_fields where key = 'autopilot' and field = 'publish_hours'");
    expect(field.options).toContain("07");
    expect(field.options).not.toContain("03");
  });
});
