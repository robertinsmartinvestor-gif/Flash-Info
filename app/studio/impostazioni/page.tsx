"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { findVoice, VOICE_CATALOG } from "@/src/media/voices";
import { useStudio } from "../shared";
import { PageHead, StatusLine, Switch } from "../ui";

interface FieldDef {
  key: string;
  field: string;
  kind: "boolean" | "integer" | "number" | "choices";
  min_value: number | null;
  max_value: number | null;
  options: string[] | null;
  section: string;
  label: string;
  help: string | null;
  position: number;
}

type Value = boolean | number | string[] | undefined;
const id = (def: Pick<FieldDef, "key" | "field">) => `${def.key}.${def.field}`;

/** Readable names for QC checks; unknown codes show as they are. */
const OPTION_LABEL: Record<string, string> = {
  verifier: "Fatti sostenuti solo in parte",
  verifier_unavailable: "Verifica non disponibile",
  verifier_incomplete: "Verifica incompleta",
  sensitive_topic: "Tema delicato",
  sensational_language: "Linguaggio sensazionalistico",
  repetition: "Ripetizioni",
  monotone_style: "Stile monotono",
  too_many_quotes: "Troppe citazioni",
  filler_sentence: "Frasi riempitive",
  duration: "Durata fuori misura",
};

const SECTION_ORDER = ["Pilota automatico", "Spesa", "Produzione", "Conservazione"];

const same = (a: Value, b: Value) => JSON.stringify(Array.isArray(a) ? [...a].sort() : a) === JSON.stringify(Array.isArray(b) ? [...b].sort() : b);

function invalid(def: FieldDef, value: Value): string | null {
  if (def.kind !== "integer" && def.kind !== "number") return null;
  if (typeof value !== "number" || Number.isNaN(value)) return "Inserisci un numero.";
  if (def.kind === "integer" && !Number.isInteger(value)) return "Serve un numero intero.";
  if ((def.min_value !== null && value < Number(def.min_value)) || (def.max_value !== null && value > Number(def.max_value))) {
    return `Tra ${def.min_value} e ${def.max_value}.`;
  }
  return null;
}

function Control({ def, value, disabled, onChange }: { def: FieldDef; value: Value; disabled: boolean; onChange: (value: Value) => void }) {
  const inputId = `setting-${def.key}-${def.field}`;
  if (def.kind === "boolean") return <Switch checked={value === true} disabled={disabled} onChange={onChange} label={def.label} />;
  if (def.kind === "choices") return null;
  return (
    <input
      id={inputId}
      className="input"
      type="number"
      inputMode={def.kind === "integer" ? "numeric" : "decimal"}
      step={def.kind === "integer" ? 1 : 0.5}
      min={def.min_value ?? undefined}
      max={def.max_value ?? undefined}
      disabled={disabled}
      value={typeof value === "number" && !Number.isNaN(value) ? value : ""}
      onChange={(event) => onChange(event.target.value === "" ? Number.NaN : Number(event.target.value))}
    />
  );
}

function VoiceSection({ isAdmin }: { isAdmin: boolean }) {
  const { client } = useStudio();
  const [saved, setSaved] = useState("");
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void client.from("app_settings").select("value").eq("key", "tts_voice").maybeSingle().then(({ data, error }) => {
      if (error) setMessage("Voce non leggibile.");
      const voice = findVoice(data?.value)?.voice ?? "";
      setSaved(voice);
      setChoice(voice);
    });
  }, [client]);

  async function save() {
    const option = VOICE_CATALOG.find((item) => item.voice === choice);
    if (!option) return;
    setBusy(true);
    setMessage("");
    const { error } = await client.rpc("set_tts_voice", { p_provider: option.provider, p_voice: option.voice });
    setBusy(false);
    if (error) setMessage("Voce non salvata.");
    else {
      setSaved(option.voice);
      setMessage("Voce salvata: vale dai prossimi audio.");
    }
  }

  const selected = VOICE_CATALOG.find((item) => item.voice === choice);
  return (
    <section className="card">
      <h2>Voce</h2>
      <p className="sub">La voce dei prossimi audio.</p>
      <div className="field">
        <label htmlFor="voice">Voce narrante</label>
        <select id="voice" className="select" value={choice} disabled={!isAdmin} onChange={(event) => setChoice(event.target.value)}>
          {!saved && <option value="">Nessuna voce valida</option>}
          {VOICE_CATALOG.map((option) => <option key={option.voice} value={option.voice}>{option.label}</option>)}
        </select>
        {selected && !selected.verified && <p className="help" style={{ color: "var(--bad)" }}>Voce mai provata con credenziali reali: la produzione può fallire.</p>}
      </div>
      {isAdmin && <button type="button" className="btn" onClick={save} disabled={busy || !choice || choice === saved}>Salva voce</button>}
      <StatusLine message={message} />
    </section>
  );
}

export default function SettingsPage() {
  const { client, role } = useStudio();
  const isAdmin = role === "admin";
  const [defs, setDefs] = useState<FieldDef[] | null>(null);
  const [saved, setSaved] = useState<Record<string, Value>>({});
  const [draft, setDraft] = useState<Record<string, Value>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    const [fields, settings] = await Promise.all([
      client.from("setting_fields").select("*").order("position"),
      client.from("app_settings").select("key, value"),
    ]);
    if (fields.error || settings.error) {
      setMessage("Impostazioni non leggibili.");
      setFailed(true);
      setDefs([]);
      return;
    }
    const values = new Map(settings.data.map((row) => [row.key as string, (row.value ?? {}) as Record<string, Value>]));
    const current: Record<string, Value> = {};
    for (const def of fields.data as FieldDef[]) current[id(def)] = values.get(def.key)?.[def.field];
    setDefs(fields.data as FieldDef[]);
    setSaved(current);
    setDraft(current);
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const sections = useMemo(() => {
    const groups = new Map<string, FieldDef[]>();
    for (const def of defs ?? []) groups.set(def.section, [...(groups.get(def.section) ?? []), def]);
    const rank = (name: string) => (SECTION_ORDER.indexOf(name) + 1 || SECTION_ORDER.length + 1);
    return [...groups.entries()].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
  }, [defs]);

  const changed = (defs ?? []).filter((def) => !same(draft[id(def)], saved[id(def)]));
  const errors = changed.map((def) => invalid(def, draft[id(def)])).filter(Boolean);

  async function save() {
    setBusy(true);
    setMessage("");
    setFailed(false);
    const refused: string[] = [];
    for (const def of changed) {
      const { error } = await client.rpc("update_setting", { p_key: def.key, p_field: def.field, p_value: draft[id(def)] });
      if (error) refused.push(def.label);
    }
    await load();
    setBusy(false);
    setFailed(refused.length > 0);
    setMessage(refused.length ? `Non salvate: ${refused.join(", ")}.` : `${changed.length === 1 ? "Modifica salvata" : `${changed.length} modifiche salvate`}. Valgono dal prossimo giro.`);
  }

  return (
    <>
      <PageHead title="Impostazioni" subtitle={isAdmin ? "Regole del pilota, spesa e produzione. Ogni modifica è registrata." : "Solo un admin può modificarle."} />

      {!defs && <p className="empty">Caricamento…</p>}

      <div className="grid two">
        {sections.map(([section, fields]) => (
          <section key={section} className="card">
            <h2>{section}</h2>
            <div style={{ marginTop: 8 }}>
              {fields.map((def) => {
                const key = id(def);
                const value = draft[key];
                const dirty = !same(value, saved[key]);
                const error = dirty ? invalid(def, value) : null;
                return (
                  <div key={key} className={`setting${dirty ? " dirty" : ""}`}>
                    <label className="label-text" htmlFor={`setting-${def.key}-${def.field}`}>{def.label}</label>
                    <div className="control">
                      <Control def={def} value={value} disabled={!isAdmin || busy} onChange={(next) => setDraft((all) => ({ ...all, [key]: next }))} />
                    </div>
                    {def.kind === "choices" && (
                      <div className="chips" role="group" aria-label={def.label}>
                        {(def.options ?? []).map((option) => {
                          const list = Array.isArray(value) ? value : [];
                          const on = list.includes(option);
                          return (
                            <button
                              key={option}
                              type="button"
                              className="chip"
                              aria-pressed={on}
                              disabled={!isAdmin || busy}
                              onClick={() => setDraft((all) => ({ ...all, [key]: on ? list.filter((item) => item !== option) : [...list, option] }))}
                            >
                              {OPTION_LABEL[option] ?? (/^\d{2}$/.test(option) ? `${option}:00` : option)}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {(error || def.help) && <p className="help" style={error ? { color: "var(--bad)" } : undefined}>{error ?? def.help}</p>}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
        {defs && <VoiceSection isAdmin={isAdmin} />}
      </div>

      {isAdmin && changed.length > 0 && (
        <div className="savebar" role="region" aria-label="Modifiche non salvate">
          <span>{changed.length === 1 ? "1 modifica non salvata" : `${changed.length} modifiche non salvate`}</span>
          <div className="actions">
            <button type="button" className="btn ghost small" disabled={busy} onClick={() => setDraft(saved)}>Annulla</button>
            <button type="button" className="btn primary small" disabled={busy || errors.length > 0} onClick={() => void save()}>Salva</button>
          </div>
        </div>
      )}
      <StatusLine message={message} error={failed} />
    </>
  );
}
