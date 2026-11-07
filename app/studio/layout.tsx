"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { button, field, small, StudioContext, supabase } from "./shared";

const MENU = [{ href: "/studio/voce", label: "Voce" }];

export default function StudioLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function load() {
    if (!supabase) return;
    const { data } = await supabase.auth.getSession();
    setSignedIn(Boolean(data.session));
    if (data.session) {
      const staff = await supabase.from("admin_users").select("role").eq("user_id", data.session.user.id).maybeSingle();
      if (staff.error) setMessage("Profilo non leggibile.");
      setRole(staff.data?.role ?? null);
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

  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 480, margin: "40px auto", padding: "0 16px" }}>
      <h1 style={{ fontSize: 20, marginBottom: 24 }}>OgniOra Studio</h1>

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
              <nav aria-label="Studio" style={{ display: "flex", gap: 16, marginBottom: 24, fontSize: 14 }}>
                {MENU.map((item) => (
                  <Link key={item.href} href={item.href} aria-current={pathname === item.href ? "page" : undefined} style={{ color: "#111", fontWeight: pathname === item.href ? 700 : 400 }}>
                    {item.label}
                  </Link>
                ))}
              </nav>
              <StudioContext.Provider value={{ client: supabase, role }}>{children}</StudioContext.Provider>
            </>
          )}
          <p style={{ marginTop: 24 }}><button type="button" onClick={signOut} style={{ ...button, background: "#fff", color: "#111", border: "1px solid #ddd" }}>Esci</button></p>
        </>
      )}

      <p role="status" style={{ ...small, marginTop: 16 }}>{message}</p>
    </main>
  );
}
