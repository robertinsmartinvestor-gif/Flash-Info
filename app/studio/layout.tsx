"use client";

import "./studio.css";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { StudioContext, supabase } from "./shared";
import { StatusLine } from "./ui";

const ICONS: Record<string, ReactNode> = {
  overview: <path d="M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z" />,
  review: <path d="M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9" />,
  publish: <path d="M22 8.5a2.5 2.5 0 0 0-1.8-2.4C18.6 5.6 12 5.6 12 5.6s-6.6 0-8.2.5A2.5 2.5 0 0 0 2 8.5 26 26 0 0 0 1.6 12c0 1.2.1 2.4.4 3.5a2.5 2.5 0 0 0 1.8 2.4c1.6.5 8.2.5 8.2.5s6.6 0 8.2-.5a2.5 2.5 0 0 0 1.8-2.4c.3-1.1.4-2.3.4-3.5s-.1-2.4-.4-3.5zM10 15V9l5 3z" />,
  settings: <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />,
};

const MENU = [
  { href: "/studio", label: "Panoramica", icon: "overview" },
  { href: "/studio/revisione", label: "Revisione", icon: "review", counter: "review" as const },
  { href: "/studio/pubblicazioni", label: "Pubblicazioni", icon: "publish" },
  { href: "/studio/impostazioni", label: "Impostazioni", icon: "settings" },
];

function Icon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

function Brand() {
  return (
    <span className="brand">
      <span>Ogni<b>Ora</b></span>
      <small>Studio</small>
    </span>
  );
}

export default function StudioLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [toReview, setToReview] = useState(0);

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.auth.getSession();
    setSignedIn(Boolean(data.session));
    if (data.session) {
      setUserEmail(data.session.user.email ?? "");
      const staff = await supabase.from("admin_users").select("role").eq("user_id", data.session.user.id).maybeSingle();
      if (staff.error) setMessage("Profilo non leggibile.");
      setRole(staff.data?.role ?? null);
    }
    setReady(true);
  }, []);

  const refreshCounts = useCallback(() => {
    if (!supabase) return;
    void supabase.from("scripts").select("id", { count: "exact", head: true }).eq("status", "in_review").then(({ count }) => setToReview(count ?? 0));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (role) refreshCounts();
  }, [role, refreshCounts, pathname]);

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

  const studio = useMemo(
    () => (supabase && role ? { client: supabase, role, email: userEmail, refreshCounts } : null),
    [role, userEmail, refreshCounts],
  );

  if (!supabase || !ready || !signedIn || !studio) {
    return (
      <main className="signin">
        <div className="card">
          <Brand />
          {!supabase && <p className="muted">Studio non configurato: mancano le variabili pubbliche di Supabase.</p>}
          {supabase && !ready && <p className="muted">Caricamento…</p>}
          {supabase && ready && !signedIn && (
            <form onSubmit={signIn}>
              <div className="field">
                <label htmlFor="email">Email</label>
                <input id="email" className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="password">Password</label>
                <input id="password" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <button type="submit" disabled={busy} className="btn primary" style={{ width: "100%" }}>Accedi</button>
            </form>
          )}
          {supabase && ready && signedIn && !role && (
            <>
              <p className="muted">Questo utente non fa parte dello staff.</p>
              <button type="button" className="btn ghost" onClick={signOut}>Esci</button>
            </>
          )}
          <StatusLine message={message} error />
        </div>
      </main>
    );
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link href="/studio" style={{ textDecoration: "none" }}><Brand /></Link>
        <nav className="nav" aria-label="Studio">
          {MENU.map((item) => {
            const active = item.href === "/studio" ? pathname === "/studio" : pathname.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}>
                <Icon name={item.icon} />
                {item.label}
                {item.counter === "review" && toReview > 0 && <span className="count" aria-label={`${toReview} da rivedere`}>{toReview}</span>}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          <span className="who" title={userEmail}>{userEmail}</span>
          <span>{studio.role === "admin" ? "Admin" : "Editor"}</span>
          <button type="button" onClick={signOut}>Esci</button>
        </div>
      </aside>
      <main className="content">
        <StudioContext.Provider value={studio}>{children}</StudioContext.Provider>
      </main>
    </div>
  );
}
