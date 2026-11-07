import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { findVoice, VOICE_CATALOG } from "@/src/media/voices";
import { asRole, createDatabase } from "../helpers/database";

let db: PGlite;
const ADMIN = randomUUID();
const EDITOR = randomUUID();

const setVoice = (user: string, provider: string, voice: string) =>
  asRole(db, "authenticated", user, () => db.query("select set_tts_voice($1, $2)", [provider, voice]));
const setting = async () => (await db.query<{ value: unknown }>("select value from app_settings where key = 'tts_voice'")).rows[0]?.value;

beforeAll(async () => {
  db = await createDatabase();
  for (const [id, role] of [[ADMIN, "admin"], [EDITOR, "editor"]]) {
    await db.query("insert into auth.users (id) values ($1)", [id]);
    await db.query("insert into admin_users (user_id, role) values ($1, $2)", [id, role]);
  }
});

describe("tts_voice", () => {
  it("starts on the voice chosen with the listening test", async () => {
    expect(findVoice(await setting())?.voice).toBe("it-IT-Chirp3-HD-Charon");
  });

  it("accepts every catalog voice and records who changed it", async () => {
    for (const { provider, voice } of VOICE_CATALOG) {
      await setVoice(ADMIN, provider, voice);
      expect(await setting()).toEqual({ provider, voice });
    }
    const audit = await db.query<{ actor_id: string; data: { to: { voice: string } } }>(
      "select actor_id, data from audit_logs where action = 'settings.tts_voice_changed' order by created_at desc limit 1",
    );
    expect(audit.rows[0]?.actor_id).toBe(ADMIN);
    expect(audit.rows[0]?.data.to.voice).toBe(VOICE_CATALOG.at(-1)?.voice);
  });

  it("refuses an editor", async () => {
    await expect(setVoice(EDITOR, "google", "it-IT-Chirp3-HD-Charon")).rejects.toThrow("admin access required");
  });

  it("refuses unknown voices and a voice paired with the wrong provider", async () => {
    await expect(setVoice(ADMIN, "google", "it-IT-Chirp3-HD-Nobody")).rejects.toThrow("voice not allowed");
    await expect(setVoice(ADMIN, "azure", "it-IT-Chirp3-HD-Charon")).rejects.toThrow("voice not allowed");
  });

  it("gives the anonymous role no way in", async () => {
    await expect(asRole(db, "anon", null, () => db.query("select set_tts_voice('google', 'it-IT-Chirp3-HD-Charon')"))).rejects.toThrow("permission denied");
  });

  it("does not let staff write the setting directly", async () => {
    await expect(asRole(db, "authenticated", ADMIN, () => db.query("update app_settings set value = '{}' where key = 'tts_voice'"))).rejects.toThrow("permission denied");
  });
});

describe("findVoice", () => {
  it("rejects anything outside the catalog", () => {
    expect(findVoice(null)).toBeNull();
    expect(findVoice({ provider: "azure", voice: "it-IT-Chirp3-HD-Charon" })).toBeNull();
    expect(findVoice({ provider: "google", voice: "../admin" })).toBeNull();
  });
});
