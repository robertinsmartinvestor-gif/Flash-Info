import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asRole, createDatabase } from "../helpers/database";

let db: PGlite;
const ADMIN = randomUUID();
const EDITOR = randomUUID();
type Row = Record<string, unknown>;

const update = (user: string | null, key: string, field: string, value: unknown) =>
  asRole(db, user ? "authenticated" : "anon", user, () =>
    db.query<Row>("select update_setting($1, $2, $3::jsonb) as value", [key, field, JSON.stringify(value)]),
  );
const setting = async (key: string) => (await db.query<{ value: Record<string, unknown> }>("select value from app_settings where key = $1", [key])).rows[0]?.value;

beforeAll(async () => {
  db = await createDatabase();
  for (const id of [ADMIN, EDITOR]) await db.query("insert into auth.users (id) values ($1)", [id]);
  await db.query("insert into admin_users (user_id, role) values ($1, 'admin'), ($2, 'editor')", [ADMIN, EDITOR]);
});

describe("setting_fields", () => {
  it("describes only values that exist in app_settings", async () => {
    const orphans = await db.query("select f.key, f.field from setting_fields f left join app_settings s on s.key = f.key where s.value -> f.field is null");
    expect(orphans.rows).toEqual([]);
  });

  it("keeps the budget in force when jobs start reading it from the database", async () => {
    expect((await setting("budget"))?.monthly_usd).toBe(5);
  });

  it("is readable by staff only", async () => {
    const count = (user: string) => asRole(db, "authenticated", user, () => db.query("select 1 from setting_fields"));
    expect((await count(EDITOR)).rows.length).toBeGreaterThan(0);
    expect((await count(randomUUID())).rows).toEqual([]);
  });
});

describe("update_setting", () => {
  it("changes one field, keeps the others and audits the change", async () => {
    await update(ADMIN, "autopilot", "max_stories_per_day", 5);
    const value = await setting("autopilot");
    expect(value).toMatchObject({ max_stories_per_day: 5, enabled: true, min_gap_hours: 3 });
    const audit = await db.query<Row>("select actor_id, data from audit_logs where action = 'settings.changed' order by created_at desc limit 1");
    expect(audit.rows[0]).toEqual({ actor_id: ADMIN, data: { field: "max_stories_per_day", from: 3, to: 5 } });
  });

  it("accepts the types and bounds of each kind", async () => {
    await update(ADMIN, "autopilot", "enabled", false);
    await update(ADMIN, "budget", "monthly_usd", 12.5);
    await update(ADMIN, "autopilot", "hold_checks", ["verifier", "verifier", "sensitive_topic"]);
    expect(await setting("autopilot")).toMatchObject({ enabled: false, hold_checks: ["sensitive_topic", "verifier"] });
    expect((await setting("budget"))?.monthly_usd).toBe(12.5);
    await update(ADMIN, "autopilot", "enabled", true);
  });

  it("refuses wrong types, out-of-range values and unknown options", async () => {
    await expect(update(ADMIN, "autopilot", "enabled", "true")).rejects.toThrow("expected true or false");
    await expect(update(ADMIN, "autopilot", "max_stories_per_day", "4")).rejects.toThrow("expected a number");
    await expect(update(ADMIN, "autopilot", "max_stories_per_day", 2.5)).rejects.toThrow("whole number");
    await expect(update(ADMIN, "autopilot", "max_stories_per_day", 99)).rejects.toThrow("out of range");
    await expect(update(ADMIN, "budget", "monthly_usd", -1)).rejects.toThrow("out of range");
    await expect(update(ADMIN, "autopilot", "hold_checks", ["drop table"])).rejects.toThrow("unknown option");
    await expect(update(ADMIN, "autopilot", "hold_checks", "verifier")).rejects.toThrow("unknown option");
  });

  it("refuses fields that are not in the registry, such as the voice", async () => {
    await expect(update(ADMIN, "tts_voice", "voice", "x")).rejects.toThrow("unknown setting");
    await expect(update(ADMIN, "autopilot", "secret", true)).rejects.toThrow("unknown setting");
  });

  it("is for admins only", async () => {
    await expect(update(EDITOR, "autopilot", "enabled", false)).rejects.toThrow("admin access required");
    await expect(update(null, "autopilot", "enabled", false)).rejects.toThrow("permission denied");
    expect((await setting("autopilot"))?.enabled).toBe(true);
  });
});
