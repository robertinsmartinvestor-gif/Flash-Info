import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asRole, createDatabase } from "../helpers/database";

const ADMIN = randomUUID();
const EDITOR = randomUUID();
let db: PGlite;

async function seedEvent(sources: number): Promise<string> {
  const event = (await db.query<{ id: string }>(
    "insert into news_events (title, independent_sources) values ('Evento sintetico', $1) returning id", [sources],
  )).rows[0]!;
  await db.query("insert into editorial_candidates (event_id, format, score) values ($1, 'flash', 60)", [event.id]);
  for (let i = 0; i < sources; i += 1) {
    const slug = randomUUID().slice(0, 8);
    const source = (await db.query<{ id: string }>(
      "insert into news_sources (slug, name, publisher, homepage_url, feed_url, group_key) values ($1, $2, $2, $3, $4, $5) returning id",
      [slug, "Fonte " + i, "https://example.com", "https://example.com/feed/" + slug, "group-" + slug],
    )).rows[0]!;
    const article = (await db.query<{ id: string }>(
      "insert into news_articles (source_id, url, canonical_url, title, summary, publisher, content_hash, published_at) values ($1,$2,$2,'Titolo sintetico','Sommario sintetico',$3,$4,now()) returning id",
      [source.id, "https://example.com/story/" + slug, "Fonte " + i, slug],
    )).rows[0]!;
    await db.query("insert into news_event_sources (event_id, article_id) values ($1,$2)", [event.id, article.id]);
  }
  return event.id;
}

const headline = "Titolo originale di prova";
const summary = "Questo testo sintetico serve a verificare il flusso editoriale del riepilogo.";
const publish = (eventId: string, userId = ADMIN) =>
  asRole(db, "authenticated", userId, () =>
    db.query<{ publish_digest_item: string }>("select publish_digest_item($1,$2,$3)", [eventId, headline, summary]));

beforeAll(async () => {
  db = await createDatabase();
  await db.query("insert into auth.users (id) values ($1),($2)", [ADMIN, EDITOR]);
  await db.query("insert into admin_users (user_id, role) values ($1,'admin'),($2,'editor')", [ADMIN, EDITOR]);
});

describe("public digest gate", () => {
  it("keeps raw news private and rejects editor or single-source publication", async () => {
    const eligible = await seedEvent(2);
    const single = await seedEvent(1);
    await expect(asRole(db, "anon", null, () => db.query("select * from news_articles"))).rejects.toThrow(/permission denied/);
    await expect(asRole(db, "anon", null, () => db.query("select publish_digest_item($1,$2,$3)", [eligible, headline, summary]))).rejects.toThrow(/permission denied/);
    await expect(publish(eligible, EDITOR)).rejects.toThrow(/admin access required/);
    await expect(publish(single)).rejects.toThrow(/two independent source groups required/);
  });

  it("publishes a reviewed event with source links and hides it after retraction", async () => {
    const eventId = await seedEvent(2);
    const result = await publish(eventId);
    const id = result.rows[0]!.publish_digest_item;
    const visible = await asRole(db, "anon", null, () => db.query<{ source_links: unknown[] }>(
      "select source_links from digest_items where id = $1", [id],
    ));
    expect(visible.rows[0]!.source_links).toHaveLength(2);
    const signedInVisitor = await asRole(db, "authenticated", randomUUID(), () =>
      db.query("select id from digest_items where id = $1", [id]));
    expect(signedInVisitor.rows).toHaveLength(1);
    await asRole(db, "authenticated", ADMIN, () => db.query(
      "select amend_digest_item($1,$2,$3)", [id, "Titolo corretto di prova", summary + " Aggiornato."],
    ));
    const amended = await asRole(db, "anon", null, () => db.query<{ headline: string; amended_at: string }>(
      "select headline, amended_at from digest_items where id = $1", [id],
    ));
    expect(amended.rows[0]!.headline).toBe("Titolo corretto di prova");
    expect(amended.rows[0]!.amended_at).not.toBeNull();
    await expect(publish(eventId)).rejects.toThrow(/duplicate key/);
    await asRole(db, "authenticated", ADMIN, () => db.query("select retract_digest_item($1)", [id]));
    const hidden = await asRole(db, "anon", null, () => db.query("select id from digest_items where id = $1", [id]));
    expect(hidden.rows).toEqual([]);
  });
});
