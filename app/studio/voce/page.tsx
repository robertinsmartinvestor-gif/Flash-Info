"use client";

import { createClient } from "@supabase/supabase-js";
import { type FormEvent, useEffect, useState } from "react";
import { findVoice, VOICE_CATALOG } from "@/src/media/voices";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = url && anonKey ? createClient(url, anonKey) : null;

const field = { width: "100%", boxSizing: "border-box", padding: "8px 10px", border: "1px solid #ddd", borderRadius: 8, fontSize: 14, marginBottom: 12 } as const;
const button = { background: "#111", color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontSize: 14, fontWeight: 600, cursor: "pointer" } as const;
const small = { fontSize: 13, color: "#666" } as const;

export default function VoicePage() {
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [saved, setSaved] = useState("");
  const [choice, setChoice] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function load() {
    if (!supabase) return;
    const { data } = await supabase.auth.getSession();
    setSignedIn(Boolean(data.session));
    if (data.session) {
      const [staff, setting] = await Promise.all([
        supabase.from("admin_users").select("role").eq("user_id", data.session.user.id).maybeSingle(),
        supabase.from("app_settings").select("value").eq("key", "tts_voice").maybeSingle(),
      ]);
      if (staff.error || setting.error) setMessage("Impostazione non leggibile.");
      setRole(staff.data?.role ?? null);
      const voice = findVoice(setting.data?.value)?.voice ?? "";
      setSaved(voice);
      setChoice(voice);
    }
    setReady(true);
  }

  useEffect(() => {
    void load();
  }, []);

  async function signIn(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setMessage("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setPassword("");
    if (error) setMessage("Accesso non riuscito.");
    else await load();
    setBusy(false);
  }

  async function signOut() {
    await supabase?.auth.signOut();
    setSignedIn(false);
    setRole(null);
    setMessage("");
  }

  async function save() {
    const option = VOICE_CATALOG.find((item) => item.voice === choice);
    if (!supabase || !option) return;
    setBusy(true);
    setMessage("");
    const { error } = await supabase.rpc("set_tts_voice", { p_provider: option.provider, p_voice: option.voice });
    if (error) {
      setMessage("Salvataggio non riuscito.");
    } else {
      setSaved(option.voice);
      setMessage("Voce salvata.");
    }
    setBusy(false);
  }

  const selected = VOICE_CATALOG.find((item) => item.voice === choice);
  const isAdmin = role === "admin";
  const unchanged = busy || !choice || choice === saved;

  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 480, margin: "40px auto", padding: "0 16px" }}>
      <h1 style={{ fontSize: 20, marginBottom: 24 }}>OgniOra Studio: voce</h1>

      {!supabase && <p style={small}>Studio non configurato: mancano le variabili pubbliche di Supabase.</p>}
      {supabase && !ready && <p style={small}>Caricamento…</p>}

      {supabase && ready && !signedIn && (
        <form onSubmit={signIn}>
          <label htmlFor="email" style={small}>Email</label>
          <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} style={field} />
          <label htmlFor="password" style={small}>Password</label>
          <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} style={field} />
          <button type="submit" disabled={busy} style={button}>Accedi</button>
        </form>
      )}

      {supabase && ready && signedIn && (
        <>
          {!role && <p style={small}>Questo utente non fa parte dello staff.</p>}
          {role && (
            <>
              <label htmlFor="voice" style={small}>Voce dei prossimi audio</label>
              <select id="voice" value={choice} disabled={!isAdmin} onChange={(e) => setChoice(e.target.value)} style={field}>
                {!saved && <option value="">Nessuna voce valida</option>}
                {VOICE_CATALOG.map((option) => <option key={option.voice} value={option.voice}>{option.label}</option>)}
              </select>
              {selected && !selected.verified && <p style={{ ...small, color: "#b42318" }}>Voce mai provata con credenziali reali: la produzione può fallire finché non c&apos;è la chiave del provider.</p>}
              {!isAdmin && <p style={small}>Solo un admin può cambiare la voce.</p>}
              {isAdmin && <button type="button" onClick={save} disabled={unchanged} style={{ ...button, opacity: unchanged ? 0.5 : 1 }}>Salva</button>}
            </>
          )}
          <p style={{ marginTop: 24 }}><button type="button" onClick={signOut} style={{ ...button, background: "#fff", color: "#111", border: "1px solid #ddd" }}>Esci</button></p>
        </>
      )}

      <p role="status" style={{ ...small, marginTop: 16 }}>{message}</p>
    </main>
  );
}
