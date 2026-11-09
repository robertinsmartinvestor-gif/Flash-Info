import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { findCopiedText } from "@/src/public/originality";
import { asRole, createDatabase } from "../helpers/database";

const ADMIN = randomUUID();
const EDITOR = randomUUID();
let db: PGlite;

interface SeedOptions {
  sources?: number;
  sameGroup?: boolean;
  candidateStatus?: string;
  lastSeenHoursAgo?: number;
  title?: string;
  summary?: string;
  url?: (slug: string) => string;
}

async function seedEvent(options: SeedOptions = {}): Promise<{ eventId: string; candidateId: string }> {
  const sources = options.sources ?? 2;
  const event = (await db.query<{ id: string }>(
    "insert into news_events (title, independent_sources, last_seen_at, category) values ('Evento sintetico', $1, now() - make_interval(hours => $2), 'economia') returning id",
    [sources, options.lastSeenHoursAgo ?? 1],
  )).rows[0]!;
  const candidate = (await db.query<{ id: string }>(
    "insert into editorial_candidates (event_id, format, score, status) values ($1, 'flash', 60, $2) returning id",
    [event.id, options.candidateStatus ?? "proposed"],
  )).rows[0]!;
  const group = "group-" + randomUUID().slice(0, 8);
  for (let i = 0; i < sources; i += 1) {
    const slug = randomUUID().slice(0, 8);
    const source = (await db.query<{ id: string }>(
      "insert into news_sources (slug, name, publisher, homepage_url, feed_url, group_key) values ($1, $2, $2, $3, $4, $5) returning id",
      [slug, "Fonte " + i, "https://example.com", "https://example.com/feed/" + slug, options.sameGroup ? group : "group-" + slug],
    )).rows[0]!;
    const url = options.url ? options.url(slug) : "https://example.com/story/" + slug;
    const article = (await db.query<{ id: string }>(
      "insert into news_articles (source_id, url, canonical_url, title, summary, publisher, content_hash, published_at) values ($1,$2,$2,$3,$4,$5,$6,now()) returning id",
      [source.id, url, options.title ?? "Il governo approva il decreto sulle accise dei carburanti",
        options.summary ?? "Il consiglio dei ministri ha approvato nella serata di ieri un decreto che interviene sulle accise dei carburanti per tre mesi.",
        "Fonte " + i, slug],
    )).rows[0]!;
    await db.query("insert into news_event_sources (event_id, article_id) values ($1,$2)", [event.id, article.id]);
  }
  return { eventId: event.id, candidateId: candidate.id };
}

const headline = "Accise ridotte per tre mesi";
const summary = "Il taglio vale fino a febbraio secondo entrambe le fonti; il costo per lo Stato non è ancora stato quantificato.";
const asAdmin = <T>(fn: () => Promise<T>) => asRole(db, "authenticated", ADMIN, fn);
const publish = (eventId: string, userId = ADMIN, text = { headline, summary }) =>
  asRole(db, "authenticated", userId, () =>
    db.query<{ publish_digest_item: string }>("select publish_digest_item($1,$2,$3)", [eventId, text.headline, text.summary]));

beforeAll(async () => {
  db = await createDatabase();
  await db.query("insert into auth.users (id) values ($1),($2)", [ADMIN, EDITOR]);
  await db.query("insert into admin_users (user_id, role) values ($1,'admin'),($2,'editor')", [ADMIN, EDITOR]);
});

describe("public digest gate", () => {
  it("keeps raw news, candidates, scripts and funnel private to anonymous readers", async () => {
    for (const table of ["news_articles", "news_events", "editorial_candidates", "scripts", "script_versions", "ingest_runs", "metric_tracking", "audit_logs", "editorial_funnel_24h"]) {
      await expect(asRole(db, "anon", null, () => db.query(`select * from ${table} limit 1`)), table).rejects.toThrow(/permission denied/);
    }
  });

  it("refuses anonymous callers, editors and signed-in visitors", async () => {
    const { eventId } = await seedEvent();
    await expect(asRole(db, "anon", null, () => db.query("select publish_digest_item($1,$2,$3)", [eventId, headline, summary]))).rejects.toThrow(/permission denied/);
    await expect(publish(eventId, EDITOR)).rejects.toThrow(/admin access required/);
    await expect(publish(eventId, randomUUID())).rejects.toThrow(/admin access required/);
  });

  it("refuses single-source, same-group, stale, selected, scripted and non-https events", async () => {
    await expect(publish((await seedEvent({ sources: 1 })).eventId)).rejects.toThrow(/two independent source groups/);
    await expect(publish((await seedEvent({ sameGroup: true })).eventId)).rejects.toThrow(/two independent source groups/);
    await expect(publish((await seedEvent({ url: (s) => "http://example.com/" + s })).eventId)).rejects.toThrow(/two independent source groups/);
    await expect(publish((await seedEvent({ lastSeenHoursAgo: 30 })).eventId)).rejects.toThrow(/absent or stale/);
    await expect(publish((await seedEvent({ candidateStatus: "selected" })).eventId)).rejects.toThrow(/only unselected/);

    // A blocked script, even if the candidate went back to proposed, never opens the digest path.
    const scripted = await seedEvent();
    await db.query("insert into scripts (candidate_id, format, status) values ($1, 'flash', 'blocked')", [scripted.candidateId]);
    await expect(publish(scripted.eventId)).rejects.toThrow(/script review path/);
  });

  it("refuses text that copies a source title or summary", async () => {
    const { eventId } = await seedEvent();
    await expect(publish(eventId, ADMIN, { headline: "Il governo approva il decreto sulle accise dei carburanti", summary }))
      .rejects.toThrow(/headline_copies_source/);
    await expect(publish(eventId, ADMIN, { headline: "IL GOVERNO approva il decreto, sulle accise: oggi", summary }))
      .rejects.toThrow(/headline_copies_source/);
    await expect(publish(eventId, ADMIN, {
      headline,
      summary: "Secondo le fonti il consiglio dei ministri ha approvato nella serata di ieri un decreto molto atteso.",
    })).rejects.toThrow(/summary_copies_source/);
    await expect(publish(eventId, ADMIN, { headline: "Corto", summary })).rejects.toThrow(/invalid digest text length/);
  });

  it("publishes with a permanent slug, exposes only public columns, and survives amend then retract", async () => {
    const { eventId } = await seedEvent();
    const id = (await publish(eventId)).rows[0]!.publish_digest_item;

    const row = await asRole(db, "anon", null, () => db.query<{ slug: string; source_links: Array<{ url: string }> }>(
      "select slug, source_links from digest_items where id = $1", [id],
    ));
    const slug = row.rows[0]!.slug;
    expect(slug).toMatch(/^\d{4}-\d{2}-\d{2}-accise-ridotte-per-tre-mesi-[0-9a-f]{6}$/);
    expect(row.rows[0]!.source_links).toHaveLength(2);
    expect(row.rows[0]!.source_links.every((link) => link.url.startsWith("https://"))).toBe(true);
    await expect(asRole(db, "anon", null, () => db.query("select reviewed_by from digest_items"))).rejects.toThrow(/permission denied/);
    await expect(asRole(db, "anon", null, () => db.query("select * from digest_items"))).rejects.toThrow(/permission denied/);
    await expect(asRole(db, "anon", null, () => db.query("update digest_items set headline = 'x' where id = $1", [id]))).rejects.toThrow(/permission denied/);
    await expect(asRole(db, "anon", null, () => db.query("insert into digest_items (slug) values ('x')"))).rejects.toThrow(/permission denied/);
    await expect(asAdmin(() => db.query("update digest_items set headline = 'Titolo cambiato a mano' where id = $1", [id]))).rejects.toThrow(/permission denied/);
    const signedInVisitor = await asRole(db, "authenticated", randomUUID(), () => db.query("select id from digest_items where id = $1", [id]));
    expect(signedInVisitor.rows).toHaveLength(1);

    await expect(publish(eventId)).rejects.toThrow(/duplicate key/);
    await expect(asAdmin(() => db.query("select amend_digest_item($1,$2,$3,$4)", [id, "Accise ridotte fino a febbraio", summary, ""])))
      .rejects.toThrow(/correction note/);
    await expect(asRole(db, "authenticated", EDITOR, () => db.query("select amend_digest_item($1,$2,$3,$4)", [id, "Accise ridotte fino a febbraio", summary, "Corretta la durata."])))
      .rejects.toThrow(/admin access required/);
    await asAdmin(() => db.query("select amend_digest_item($1,$2,$3,$4)", [id, "Accise ridotte fino a febbraio", summary, "Corretta la durata del taglio."]));
    const amended = await asRole(db, "anon", null, () => db.query<{ slug: string; headline: string; amended_at: string; amendment_note: string }>(
      "select slug, headline, amended_at, amendment_note from digest_items where id = $1", [id],
    ));
    expect(amended.rows[0]).toMatchObject({ slug, headline: "Accise ridotte fino a febbraio", amendment_note: "Corretta la durata del taglio." });
    expect(amended.rows[0]!.amended_at).not.toBeNull();

    await expect(asAdmin(() => db.query("select retract_digest_item($1,$2)", [id, "no"]))).rejects.toThrow(/retraction note/);
    await asAdmin(() => db.query("select retract_digest_item($1,$2)", [id, "Una delle fonti ha smentito la notizia."]));
    const hidden = await asRole(db, "anon", null, () => db.query("select id from digest_items where id = $1", [id]));
    expect(hidden.rows).toEqual([]);
    const notice = await asRole(db, "anon", null, () => db.query<Record<string, unknown>>("select * from digest_retractions($1)", [slug]));
    expect(notice.rows).toHaveLength(1);
    expect(Object.keys(notice.rows[0]!).sort()).toEqual(["published_at", "retracted_at", "retraction_note", "slug"]);
    expect(notice.rows[0]!.retraction_note).toBe("Una delle fonti ha smentito la notizia.");
    await expect(asAdmin(() => db.query("select retract_digest_item($1,$2)", [id, "Seconda volta, non valida."]))).rejects.toThrow(/not found/);
    await expect(asAdmin(() => db.query("select amend_digest_item($1,$2,$3,$4)", [id, "Accise ridotte fino a febbraio", summary, "Dopo il ritiro."]))).rejects.toThrow(/not found/);

    const audit = await db.query<{ action: string }>("select action from audit_logs where entity_id = $1 order by id", [id]);
    expect(audit.rows.map((entry) => entry.action)).toEqual(["digest.published", "digest.amended", "digest.retracted"]);
  });

  it("lets staff, not anonymous readers, see retracted items in the table", async () => {
    const { eventId } = await seedEvent();
    const id = (await publish(eventId)).rows[0]!.publish_digest_item;
    await asAdmin(() => db.query("select retract_digest_item($1,$2)", [id, "Ritirata per verifica."]));
    const staff = await asRole(db, "authenticated", EDITOR, () => db.query<{ status: string }>("select status from digest_items where id = $1", [id]));
    expect(staff.rows[0]!.status).toBe("retracted");
  });
});

describe("copy rule parity", () => {
  it("gives the same verdict in the database and in the Studio warning", async () => {
    const { eventId } = await seedEvent();
    const title = "Il governo approva il decreto sulle accise dei carburanti";
    const rss = "Il consiglio dei ministri ha approvato nella serata di ieri un decreto che interviene sulle accise dei carburanti per tre mesi.";
    const cases: Array<[string, string]> = [
      [headline, summary],
      [title, summary],
      ["Già approvato il decreto sulle accise dei carburanti", summary],
      [headline, "Fonti concordi: il consiglio dei ministri ha approvato nella serata di ieri il testo."],
      ["Città più care, è l’ora delle accise", "Perché il governo è intervenuto: il costo non è stato ancora quantificato da nessuno."],
    ];
    for (const [h, s] of cases) {
      const db_ = (await db.query<{ r: string | null }>("select private.digest_copy_reason($1,$2,$3) as r", [eventId, h, s])).rows[0]!.r;
      const ts = findCopiedText(h, s, [{ title, summary: rss }])[0]?.field ?? null;
      expect(db_ === null ? null : db_.replace("_copies_source", ""), `${h} | ${s}`).toBe(ts);
    }
  });
});

describe("editorial funnel", () => {
  it("counts drops, exclusions, unselected candidates, blocked and held scripts", async () => {
    await db.query("delete from ingest_runs");
    await db.query(
      "insert into ingest_runs (sources_total, sources_failed, items_seen, dropped_undated, dropped_out_of_window, dropped_bad_url, dropped_duplicate, already_stored, new_articles, events_saved, candidates) values (10, 1, 120, 3, 40, 1, 6, 30, 40, 12, 4)",
    );
    await db.query("insert into news_events (title, ineligible_reason) values ('a', 'single_source'), ('b', 'single_source'), ('c', 'low_value'), ('d', null)");
    const { candidateId } = await seedEvent({ candidateStatus: "rejected" });
    const script = (await db.query<{ id: string }>("insert into scripts (candidate_id, format, status) values ($1, 'flash', 'in_review') returning id", [candidateId])).rows[0]!;
    await db.query("insert into audit_logs (actor_type, action, entity_type, entity_id) values ('system', 'script.auto_held', 'script_version', $1), ('system', 'script.auto_held', 'script_version', $1)", [script.id]);

    await expect(asRole(db, "authenticated", randomUUID(), () => db.query<Record<string, unknown>>("select * from editorial_funnel_24h")))
      .resolves.toMatchObject({ rows: [expect.objectContaining({ ingest_runs: 0, events_seen: 0 })] });

    const funnel = (await asRole(db, "authenticated", EDITOR, () => db.query<Record<string, number | string>>("select * from editorial_funnel_24h"))).rows[0]!;
    expect(Number(funnel.ingest_runs)).toBe(1);
    expect(Number(funnel.feed_items)).toBe(120);
    expect(Number(funnel.dropped_out_of_window)).toBe(40);
    expect(Number(funnel.dropped_duplicate)).toBe(6);
    expect(Number(funnel.single_source)).toBe(2);
    expect(Number(funnel.low_value)).toBe(1);
    expect(Number(funnel.unclassified)).toBe(1);
    expect(Number(funnel.scripts_held)).toBe(1);
    expect(Number(funnel.eligible_unselected)).toBeGreaterThan(0);
    expect(funnel.classified_since).not.toBeNull();
    expect(funnel.drops_since).not.toBeNull();
  });
});
