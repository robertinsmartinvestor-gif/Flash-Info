import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asRole, createDatabase } from "../helpers/database";

let db: PGlite;
const EDITOR = randomUUID();

type Row = Record<string, string>;
const service = <T,>(fn: () => Promise<T>) => asRole(db, "service_role", null, fn);

async function one(sql: string, params: unknown[] = []): Promise<Row> {
  const row = (await db.query<Row>(sql, params)).rows[0];
  if (!row) throw new Error("expected a row");
  return row;
}

async function seed(status: "approved" | "in_review" = "approved") {
  const event = await one(`insert into news_events (title) values ('e') returning id`);
  const candidate = await one(`insert into editorial_candidates (event_id, format, score, status) values ($1, 'flash', 50, 'selected') returning id`, [event.id]);
  const script = await one(`insert into scripts (candidate_id, format, status) values ($1, 'flash', $2) returning id`, [candidate.id, status]);
  const version = await one(
    `insert into script_versions (script_id, version, content, narration, word_count, estimated_seconds, qc_verdict) values ($1, 1, '{}', 't', 1, 1, 'pass') returning id`,
    [script.id],
  );
  if (status === "approved") await db.query("update scripts set approved_version_id = $1 where id = $2", [version.id, script.id]);
  const asset = await one(
    `insert into media_assets (script_version_id, kind, storage_path, mime_type, size_bytes, expires_at) values ($1, 'video', $2, 'video/mp4', 1, now() - interval '1 day') returning id`,
    [version.id, `v/${randomUUID()}.mp4`],
  );
  const queue = await one(`insert into publication_queue (script_version_id, video_asset_id, title, description) values ($1, $2, 't', 'd') returning id`, [version.id, asset.id]);
  return { candidateId: candidate.id!, queueId: queue.id!, assetId: asset.id! };
}

const beginUpload = (queueId: string) => service(() => one("select begin_upload($1) as item", [queueId]));

beforeAll(async () => {
  db = await createDatabase();
  await db.query("insert into auth.users (id) values ($1)", [EDITOR]);
  await db.query("insert into admin_users (user_id, role) values ($1, 'admin')", [EDITOR]);
});

describe("claim_candidate", () => {
  it("lets one run take a candidate, once", async () => {
    const { candidateId } = await seed();
    const claim = () => service(() => one("select claim_candidate($1) as ok", [candidateId]));
    expect((await claim()).ok).toBe(true);
    expect((await claim()).ok).toBe(false);
  });
});

describe("begin_upload", () => {
  it("hands out an approved item once, with its file", async () => {
    const { queueId } = await seed();
    const first = (await beginUpload(queueId)).item as unknown as { script_approved: boolean; storage_path: string };
    expect(first.script_approved).toBe(true);
    expect(first.storage_path).toMatch(/\.mp4$/);
    expect((await beginUpload(queueId)).item).toBeNull();
  });

  it("refuses unapproved scripts", async () => {
    const { queueId } = await seed("in_review");
    expect((await beginUpload(queueId)).item).toBeNull();
  });

  it("allows a retry after a recorded failure", async () => {
    const { queueId } = await seed();
    await beginUpload(queueId);
    await service(() => db.query("select fail_upload($1, 'quota')", [queueId]));
    expect((await beginUpload(queueId)).item).not.toBeNull();
  });

  it("never retries once a video is registered", async () => {
    const { queueId } = await seed();
    await beginUpload(queueId);
    await service(() => db.query("select register_youtube_upload($1, $2, 'private')", [queueId, `vid-${queueId}`]));
    await db.query("update publication_queue set status = 'failed' where id = $1", [queueId]);
    expect((await beginUpload(queueId)).item).toBeNull();
  });

  it("is closed to staff", async () => {
    const { queueId } = await seed();
    await expect(asRole(db, "authenticated", EDITOR, () => db.query("select begin_upload($1)", [queueId]))).rejects.toThrow(/permission denied/);
  });
});

describe("expired_media_assets", () => {
  const expired = async () => (await service(() => db.query<Row>("select id from expired_media_assets(1000)"))).rows.map((row) => row.id);

  it("protects files still needed by the queue", async () => {
    const { assetId, queueId } = await seed();
    expect(await expired()).not.toContain(assetId);
    await db.query("update publication_queue set status = 'uploaded' where id = $1", [queueId]);
    expect(await expired()).toContain(assetId);
  });
});

describe("run_retention", () => {
  it("removes old rows and keeps recent ones", async () => {
    await db.query(`insert into news_sources (id, slug, name, publisher, homepage_url, feed_url, group_key) values ('00000000-0000-4000-8000-000000000001', 'ret', 's', 'p', 'https://x.test', 'https://x.test/ret', 'g')`);
    const insert = (url: string, age: string) =>
      db.query(
        `insert into news_articles (source_id, url, canonical_url, title, publisher, content_hash, fetched_at) values ('00000000-0000-4000-8000-000000000001', $1, $1, 't', 'p', 'h', now() - $2::interval)`,
        [url, age],
      );
    await insert("https://x.test/old", "120 days");
    await insert("https://x.test/new", "1 day");
    const result = await service(() => one("select run_retention() as report"));
    expect(result.report).toMatchObject({ articles: 1 });
    expect((await one("select count(*)::int as n from news_articles")).n).toBe(1);
  });
});
