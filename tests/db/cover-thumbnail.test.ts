import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asRole, createDatabase } from "../helpers/database";

let db: PGlite;
const EDITOR = randomUUID();

type Row = Record<string, unknown>;

async function one(sql: string, params: unknown[] = []): Promise<Row> {
  const row = (await db.query<Row>(sql, params)).rows[0];
  if (!row) throw new Error("expected a row");
  return row;
}

const service = <T>(fn: () => Promise<T>) => asRole(db, "service_role", null, fn);

async function version({ video = true, cover = true } = {}): Promise<string> {
  const event = await one(`insert into news_events (title) values ('e') returning id`);
  const candidate = await one(`insert into editorial_candidates (event_id, format, score, status) values ($1, 'flash', 50, 'scripted') returning id`, [event.id]);
  const script = await one(`insert into scripts (candidate_id, format, status) values ($1, 'flash', 'approved') returning id`, [candidate.id]);
  const row = await one(
    `insert into script_versions (script_id, version, content, narration, word_count, estimated_seconds, qc_verdict, youtube_metadata)
     values ($1, 1, '{}', 't', 1, 1, 'pass', '{"title": "Titolo", "description": "D", "tags": []}') returning id`,
    [script.id],
  );
  await db.query("update scripts set approved_version_id = $1 where id = $2", [row.id, script.id]);
  if (video) await db.query(`insert into media_assets (script_version_id, kind, storage_path, mime_type, size_bytes) values ($1, 'video', $2, 'video/mp4', 1)`, [row.id, `video/${row.id}/flash-v1.mp4`]);
  if (cover) await db.query(`insert into media_assets (script_version_id, kind, storage_path, mime_type, size_bytes) values ($1, 'thumbnail', $2, 'image/png', 1)`, [row.id, `thumbnail/${row.id}/cover-v1.png`]);
  return row.id as string;
}

async function queued(): Promise<string> {
  const versionId = await version();
  return (await asRole(db, "authenticated", EDITOR, () => one("select queue_publication($1) as id", [versionId]))).id as string;
}

const status = async (id: string) => one("select status, thumbnail_status, thumbnail_attempts, thumbnail_error, last_error from publication_queue where id = $1", [id]);

beforeAll(async () => {
  db = await createDatabase();
  await db.query("insert into auth.users (id) values ($1)", [EDITOR]);
  await db.query("insert into admin_users (user_id, role) values ($1, 'editor')", [EDITOR]);
});

describe("queueing with a cover", () => {
  it("links the queue item to the cover of the same version", async () => {
    const id = await queued();
    const row = await one(
      `select q.thumbnail_status, a.kind, a.script_version_id = q.script_version_id as same_version
       from publication_queue q join media_assets a on a.id = q.thumbnail_asset_id where q.id = $1`,
      [id],
    );
    expect(row).toEqual({ thumbnail_status: "pending", kind: "thumbnail", same_version: true });
  });

  it("refuses a version with a video but no cover", async () => {
    const versionId = await version({ cover: false });
    await expect(asRole(db, "authenticated", EDITOR, () => one("select queue_publication($1) as id", [versionId]))).rejects.toThrow("no cover");
  });

  it("keeps rows queued before covers existed, with no cover", async () => {
    const versionId = await version({ cover: false });
    const asset = await one("select id from media_assets where script_version_id = $1 and kind = 'video'", [versionId]);
    const row = await one(
      `insert into publication_queue (script_version_id, video_asset_id, title, description) values ($1, $2, 'T', 'D') returning thumbnail_asset_id, thumbnail_status`,
      [versionId, asset.id],
    );
    expect(row).toEqual({ thumbnail_asset_id: null, thumbnail_status: null });
  });
});

describe("two-stage upload", () => {
  it("records the YouTube id at once, after which begin_upload refuses the item", async () => {
    const id = await queued();
    const item = (await service(() => one("select begin_upload($1) as item", [id]))).item as Row;
    expect(item.thumbnail_path).toMatch(/^thumbnail\/.+\/cover-v1\.png$/);

    await service(() => db.query("select record_youtube_video($1, 'yt-a', 'private')", [id]));
    expect(await status(id)).toMatchObject({ status: "processing" });
    expect(await one("select privacy from youtube_publications where queue_id = $1", [id])).toEqual({ privacy: "private" });

    await db.query("update publication_queue set status = 'failed' where id = $1", [id]);
    expect((await service(() => one("select begin_upload($1) as item", [id]))).item).toBeNull();
  });

  it("records the video with its visibility at once, and closes only when the cover is confirmed", async () => {
    const id = await queued();
    await service(() => db.query("select begin_upload($1)", [id]));
    // The guard on youtube_publications still applies: no public without an authorization.
    await expect(service(() => db.query("select record_youtube_video($1, 'yt-b', 'public')", [id]))).rejects.toThrow("public upload without authorization");
    await db.query("update publication_queue set privacy = 'public', public_authorized_at = now(), public_authorized_policy = 'autopilot' where id = $1", [id]);
    await service(() => db.query("select record_youtube_video($1, 'yt-b', 'public')", [id]));
    expect(await one("select privacy from youtube_publications where queue_id = $1", [id])).toEqual({ privacy: "public" });
    expect(await status(id)).toMatchObject({ status: "processing", thumbnail_status: "pending" });

    const claimed = (await service(() => one("select claim_finalize($1) as item", [id]))).item as Row;
    expect(claimed).toMatchObject({ youtube_video_id: "yt-b", youtube_privacy: "public", thumbnail_status: "pending" });
    expect((await service(() => one("select claim_finalize($1) as item", [id]))).item).toBeNull();

    await service(() => db.query("select confirm_thumbnail($1)", [id]));
    expect(await status(id)).toMatchObject({ status: "uploaded", thumbnail_status: "set" });
    expect((await one("select thumbnail_set_at is not null as set from publication_queue where id = $1", [id])).set).toBe(true);
    await expect(service(() => db.query("select confirm_thumbnail($1)", [id]))).rejects.toThrow("not being finalized");
  });

  it("records cover failures apart, and stops retrying after the limit", async () => {
    const id = await queued();
    await service(() => db.query("select begin_upload($1)", [id]));
    await service(() => db.query("select record_youtube_video($1, 'yt-c', 'private')", [id]));
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await service(() => db.query("select claim_finalize($1)", [id]));
      await service(() => db.query("select fail_thumbnail($1, 'thumbnail_set_failed:403:forbidden')", [id]));
    }
    expect(await status(id)).toMatchObject({
      status: "processing", thumbnail_status: "failed", thumbnail_attempts: 5, thumbnail_error: "thumbnail_set_failed:403:forbidden", last_error: null,
    });
    expect((await service(() => one("select claim_finalize($1) as item", [id]))).item).toBeNull();
    expect((await one("select count(*)::int as n from audit_logs where action = 'publication.thumbnail_failed' and entity_id = $1", [id])).n).toBe(5);
  });

  it("releases an item still processing without counting a cover failure", async () => {
    const id = await queued();
    await service(() => db.query("select begin_upload($1)", [id]));
    await service(() => db.query("select record_youtube_video($1, 'yt-d', 'private')", [id]));
    await service(() => db.query("select claim_finalize($1)", [id]));
    await service(() => db.query("select release_finalize($1, 'youtube_processing')", [id]));
    expect(await status(id)).toMatchObject({ status: "processing", thumbnail_attempts: 0, last_error: "youtube_processing" });
  });

  it("lets another runner take over a claim left by a crashed one", async () => {
    const id = await queued();
    await service(() => db.query("select begin_upload($1)", [id]));
    await service(() => db.query("select record_youtube_video($1, 'yt-e', 'private')", [id]));
    await service(() => db.query("select claim_finalize($1)", [id]));
    await db.query("update publication_queue set finalize_started_at = now() - interval '31 minutes' where id = $1", [id]);
    expect((await service(() => one("select claim_finalize($1) as item", [id]))).item).not.toBeNull();
  });

  it("does not record a video for an item without a cover", async () => {
    const versionId = await version({ cover: false });
    const asset = await one("select id from media_assets where script_version_id = $1 and kind = 'video'", [versionId]);
    const row = await one(`insert into publication_queue (script_version_id, video_asset_id, title, description, status) values ($1, $2, 'T', 'D', 'uploading') returning id`, [versionId, asset.id]);
    await expect(service(() => db.query("select record_youtube_video($1, 'yt-f', 'private')", [row.id]))).rejects.toThrow("not uploading with a cover");
  });

  it("is closed to editors and the public", async () => {
    const id = await queued();
    for (const fn of ["record_youtube_video($1, 'x', 'private')", "claim_finalize($1)", "confirm_thumbnail($1)", "fail_thumbnail($1, 'x')", "release_finalize($1, 'x')"]) {
      await expect(asRole(db, "authenticated", EDITOR, () => db.query(`select ${fn}`, [id]))).rejects.toThrow("permission denied");
    }
  });
});

describe("retention", () => {
  it("keeps the cover until the upload is over", async () => {
    const id = await queued();
    await db.query("update media_assets set expires_at = now() - interval '1 day' where id = (select thumbnail_asset_id from publication_queue where id = $1)", [id]);
    await db.query("update publication_queue set status = 'processing' where id = $1", [id]);
    const expired = async () => (await service(() => db.query<Row>("select id from expired_media_assets(1000)"))).rows.map((row) => row.id);
    const cover = (await one("select thumbnail_asset_id from publication_queue where id = $1", [id])).thumbnail_asset_id;
    expect(await expired()).not.toContain(cover);
    await db.query("update publication_queue set status = 'uploaded' where id = $1", [id]);
    expect(await expired()).toContain(cover);
  });
});
