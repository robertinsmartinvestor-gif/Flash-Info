import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asRole, createDatabase } from "../helpers/database";

let db: PGlite;
const EDITOR = randomUUID();
const STRANGER = randomUUID();

type Row = Record<string, unknown>;

async function one(sql: string, params: unknown[] = []): Promise<Row> {
  const row = (await db.query<Row>(sql, params)).rows[0];
  if (!row) throw new Error("expected a row");
  return row;
}

const META = { title: "Titolo <b>della</b> notizia", description: "Sintesi.\n\nFonti:\n• ANSA: https://www.ansa.it/a", tags: ["politica", "<x>", "", "a,b"] };

async function seed({ status = "approved", video = true, meta = META }: { status?: string; video?: boolean; meta?: unknown } = {}) {
  const event = await one(`insert into news_events (title) values ('e') returning id`);
  const candidate = await one(`insert into editorial_candidates (event_id, format, score, status) values ($1, 'flash', 50, 'scripted') returning id`, [event.id]);
  const script = await one(`insert into scripts (candidate_id, format, status) values ($1, 'flash', $2) returning id`, [candidate.id, status]);
  const version = await one(
    `insert into script_versions (script_id, version, content, narration, word_count, estimated_seconds, qc_verdict, youtube_metadata)
     values ($1, 1, '{}', 't', 1, 1, 'pass', $2) returning id`,
    [script.id, JSON.stringify(meta)],
  );
  if (status === "approved") await db.query("update scripts set approved_version_id = $1 where id = $2", [version.id, script.id]);
  if (video) {
    await db.query(
      `insert into media_assets (script_version_id, kind, storage_path, mime_type, size_bytes) values ($1, 'video', $2, 'video/mp4', 1), ($1, 'thumbnail', $2 || '.png', 'image/png', 1)`,
      [version.id, `video/${randomUUID()}.mp4`],
    );
  }
  return version.id as string;
}

const queue = (user: string, versionId: string) =>
  asRole(db, "authenticated", user, () => one("select queue_publication($1) as id", [versionId]));

beforeAll(async () => {
  db = await createDatabase();
  for (const id of [EDITOR, STRANGER]) await db.query("insert into auth.users (id) values ($1)", [id]);
  await db.query("insert into admin_users (user_id, role) values ($1, 'editor')", [EDITOR]);
});

describe("queue_publication", () => {
  it("queues the video as private, with clean metadata from the version", async () => {
    const versionId = await seed();
    const { id } = await queue(EDITOR, versionId);
    const row = await one("select * from publication_queue where id = $1", [id]);
    expect(row).toMatchObject({
      status: "pending",
      privacy: "private",
      contains_synthetic_media: true,
      publish_at: null,
      public_authorized_by: null,
      title: "Titolo bdella/b notizia",
      tags: ["politica", "x", "ab"],
    });
    expect(row.description).toContain("https://www.ansa.it/a");
    const audit = await one("select actor_id from audit_logs where action = 'publication.queued' and entity_id = $1", [id]);
    expect(audit.actor_id).toBe(EDITOR);
  });

  it("returns the same row on a second click", async () => {
    const versionId = await seed();
    expect((await queue(EDITOR, versionId)).id).toBe((await queue(EDITOR, versionId)).id);
  });

  it("refuses versions that are not approved or have no video", async () => {
    await expect(queue(EDITOR, await seed({ status: "in_review" }))).rejects.toThrow("only approved versions");
    await expect(queue(EDITOR, await seed({ video: false }))).rejects.toThrow("no rendered video");
  });

  it("refuses a version without a title", async () => {
    await expect(queue(EDITOR, await seed({ meta: { title: "<>" } }))).rejects.toThrow("no title");
  });

  it("refuses non-staff and anonymous callers", async () => {
    const versionId = await seed();
    await expect(queue(STRANGER, versionId)).rejects.toThrow();
    await expect(asRole(db, "anon", null, () => db.query("select queue_publication($1)", [versionId]))).rejects.toThrow("permission denied");
  });
});
