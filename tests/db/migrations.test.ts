import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asRole, createDatabase } from "../helpers/database";

const EDITOR = randomUUID();
const ADMIN = randomUUID();
const OUTSIDER = randomUUID();

let db: PGlite;

type Row = Record<string, string>;

async function first(sql: string, params: unknown[] = []): Promise<Row> {
  const result = await db.query<Row>(sql, params);
  const row = result.rows[0];
  if (!row) throw new Error("expected a row");
  return row;
}

async function seedVersion(verdict: "pass" | "needs_review" | "blocked" = "pass"): Promise<{ scriptId: string; versionId: string }> {
  const suffix = randomUUID();
  const source = await first(
    `insert into news_sources (slug, name, publisher, homepage_url, feed_url, group_key)
     values ($1, 's', 'p', 'https://x.test', $2, 'g') returning id`,
    [suffix.slice(0, 8), `https://x.test/${suffix}`],
  );
  void source;
  const event = await first(`insert into news_events (title) values ('e') returning id`);
  const candidate = await first(
    `insert into editorial_candidates (event_id, format, score) values ($1, 'flash', 50) returning id`,
    [event.id],
  );
  const script = await first(`insert into scripts (candidate_id, format) values ($1, 'flash') returning id`, [candidate.id]);
  const version = await first(
    `insert into script_versions (script_id, version, content, narration, word_count, estimated_seconds, qc_verdict)
     values ($1, 1, '{}', 'testo', 1, 1, $2) returning id`,
    [script.id, verdict],
  );
  return { scriptId: script.id!, versionId: version.id! };
}

async function seedQueue(versionId: string): Promise<string> {
  const asset = await first(
    `insert into media_assets (script_version_id, kind, storage_path, mime_type, size_bytes)
     values ($1, 'video', $2, 'video/mp4', 10) returning id`,
    [versionId, `v/${randomUUID()}.mp4`],
  );
  const queue = await first(
    `insert into publication_queue (script_version_id, video_asset_id, title, description)
     values ($1, $2, 't', 'd') returning id`,
    [versionId, asset.id],
  );
  return queue.id!;
}

const approve = (versionId: string) =>
  asRole(db, "authenticated", EDITOR, () => db.query("select approve_script_version($1)", [versionId]));

beforeAll(async () => {
  db = await createDatabase();
  await db.query("insert into auth.users (id) values ($1), ($2), ($3)", [EDITOR, ADMIN, OUTSIDER]);
  await db.query("insert into admin_users (user_id, role) values ($1, 'editor'), ($2, 'admin')", [EDITOR, ADMIN]);
});

describe("row level security", () => {
  it("is enabled on every public table", async () => {
    const result = await db.query<Row>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    expect(result.rows).toEqual([]);
  });

  it("gives anon no access to any table or RPC", async () => {
    await expect(asRole(db, "anon", null, () => db.query("select * from news_sources"))).rejects.toThrow(/permission denied/);
    await expect(asRole(db, "anon", null, () => db.query("select * from audit_logs"))).rejects.toThrow(/permission denied/);
    await expect(asRole(db, "anon", null, () => db.query("select provider_spend_usd()"))).rejects.toThrow(/permission denied/);
  });

  it("shows data to staff and nothing to other signed-in users", async () => {
    await db.query("insert into news_events (title) values ('visibile')");
    const staff = await asRole(db, "authenticated", EDITOR, () => db.query("select id from news_events"));
    const outsider = await asRole(db, "authenticated", OUTSIDER, () => db.query("select id from news_events"));
    expect(staff.rows.length).toBeGreaterThan(0);
    expect(outsider.rows).toEqual([]);
  });

  it("prevents staff from writing tables directly", async () => {
    await expect(
      asRole(db, "authenticated", EDITOR, () => db.query("update scripts set status = 'approved'")),
    ).rejects.toThrow(/permission denied/);
  });

  it("keeps service-only functions away from staff", async () => {
    await expect(
      asRole(db, "authenticated", ADMIN, () => db.query("select requeue_stale_jobs()")),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("editorial approval", () => {
  it("refuses a blocked version, for admins too", async () => {
    const { versionId } = await seedVersion("blocked");
    await expect(
      asRole(db, "authenticated", ADMIN, () => db.query("select approve_script_version($1)", [versionId])),
    ).rejects.toThrow(/blocked/);
  });

  it("refuses outsiders", async () => {
    const { versionId } = await seedVersion();
    await expect(
      asRole(db, "authenticated", OUTSIDER, () => db.query("select approve_script_version($1)", [versionId])),
    ).rejects.toThrow(/staff access/);
  });

  it("records the approver in the audit log", async () => {
    const { versionId } = await seedVersion();
    await approve(versionId);
    const log = await first(`select actor_id, actor_type from audit_logs where action = 'script.approved' and entity_id = $1`, [versionId]);
    expect(log).toEqual({ actor_id: EDITOR, actor_type: "user" });
  });

  it("keeps script versions and audit logs immutable", async () => {
    const { versionId } = await seedVersion();
    await expect(db.query("update script_versions set narration = 'x' where id = $1", [versionId])).rejects.toThrow(/not allowed/);
    await expect(db.query("delete from audit_logs")).rejects.toThrow(/not allowed/);
  });
});

describe("production jobs", () => {
  const enqueue = (versionId: string) =>
    asRole(db, "authenticated", EDITOR, async () => {
      const result = await db.query<{ id: string }>("select enqueue_production_job($1, 'render') as id", [versionId]);
      return result.rows[0]!.id;
    });

  it("refuses unapproved versions", async () => {
    const { versionId } = await seedVersion();
    await expect(enqueue(versionId)).rejects.toThrow(/approved/);
  });

  it("is idempotent, and a job is claimed once", async () => {
    await db.query("delete from production_jobs");
    const { versionId } = await seedVersion();
    await approve(versionId);
    const jobId = await enqueue(versionId);
    expect(await enqueue(versionId)).toBe(jobId);

    const claim = () => asRole(db, "service_role", null, () => db.query<Row>("select (claim_job($1, 'run-1')).id", [jobId]));
    expect((await claim()).rows[0]!.id).toBe(jobId);
    expect((await claim()).rows[0]!.id).toBeNull();
  });

  it("enforces the active job limit", async () => {
    await db.query("delete from production_jobs");
    for (let i = 0; i < 3; i += 1) {
      const { versionId } = await seedVersion();
      await approve(versionId);
      await enqueue(versionId);
    }
    const { versionId } = await seedVersion();
    await approve(versionId);
    await expect(enqueue(versionId)).rejects.toThrow(/too many active/);
  });

  it("requeues stale jobs and fails them once attempts run out", async () => {
    await db.query("delete from production_jobs");
    const { versionId } = await seedVersion();
    await approve(versionId);
    const jobId = await enqueue(versionId);
    await db.query(`update production_jobs set status = 'running', attempts = 1, heartbeat_at = now() - interval '2 hours' where id = $1`, [jobId]);
    await asRole(db, "service_role", null, () => db.query("select requeue_stale_jobs(45)"));
    expect((await first("select status from production_jobs where id = $1", [jobId])).status).toBe("queued");

    await db.query(`update production_jobs set status = 'running', attempts = 3, heartbeat_at = now() - interval '2 hours' where id = $1`, [jobId]);
    await asRole(db, "service_role", null, () => db.query("select requeue_stale_jobs(45)"));
    expect((await first("select status from production_jobs where id = $1", [jobId])).status).toBe("failed");
  });
});

describe("publication safety", () => {
  it("rejects a public row without authorization at table level", async () => {
    const { versionId } = await seedVersion();
    const queueId = await seedQueue(versionId);
    await expect(db.query("update publication_queue set privacy = 'public' where id = $1", [queueId])).rejects.toThrow(/public_requires_authorization/);
  });

  it("lets only an admin authorize public, and only for approved content", async () => {
    const { versionId } = await seedVersion();
    const queueId = await seedQueue(versionId);
    const authorize = (user: string) =>
      asRole(db, "authenticated", user, () => db.query("select authorize_public_publication($1)", [queueId]));

    await expect(authorize(EDITOR)).rejects.toThrow(/admin access/);
    await expect(authorize(ADMIN)).rejects.toThrow(/approved content/);
    await approve(versionId);
    await authorize(ADMIN);
    expect((await first("select privacy from publication_queue where id = $1", [queueId])).privacy).toBe("public");
  });

  it("refuses a recorded upload whose privacy differs from the queue", async () => {
    const { versionId } = await seedVersion();
    const queueId = await seedQueue(versionId);
    const register = (privacy: string) =>
      asRole(db, "service_role", null, () => db.query("select register_youtube_upload($1, 'vid-x', $2)", [queueId, privacy]));
    await expect(register("unlisted")).rejects.toThrow(/differs/);
    await expect(register("public")).rejects.toThrow(/without authorization/);
  });

  it("makes a double upload impossible", async () => {
    const { versionId } = await seedVersion();
    const queueId = await seedQueue(versionId);
    const register = (videoId: string) =>
      asRole(db, "service_role", null, () => db.query("select register_youtube_upload($1, $2, 'private')", [queueId, videoId]));
    await register(`vid-${queueId}`);
    await expect(register(`vid2-${queueId}`)).rejects.toThrow(/unique/);
  });

  it("keeps the publication state history", async () => {
    const { versionId } = await seedVersion();
    const queueId = await seedQueue(versionId);
    await db.query("update publication_queue set status = 'uploading' where id = $1", [queueId]);
    const history = await db.query<{ data: { to: string } }>(
      `select data from audit_logs where action = 'publication.state' and entity_id = $1 order by id`,
      [queueId],
    );
    expect(history.rows.map((row) => row.data.to)).toEqual(["pending", "uploading"]);
  });
});

describe("storage", () => {
  it("creates a private bucket", async () => {
    expect(await first("select public from storage.buckets where id = 'media'")).toEqual({ public: false });
  });
});
