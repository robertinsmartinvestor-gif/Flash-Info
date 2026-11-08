"use client";

import "./public.css";
import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { safeHttpsUrl } from "@/src/editorial/review";

interface DigestItem {
  id: string;
  headline: string;
  summary: string;
  category: string | null;
  source_links: Array<{ publisher: string; url: string }>;
  published_at: string;
  amended_at: string | null;
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const publicClient = url && key ? createClient(url, key) : null;
const DAY = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", day: "numeric", month: "long", year: "numeric" });
const TIME = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit" });

export default function Home() {
  const [items, setItems] = useState<DigestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!publicClient) { setLoading(false); return; }
    void publicClient.from("digest_items")
      .select("id, headline, summary, category, source_links, published_at, amended_at")
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .limit(30)
      .then(({ data, error }) => {
        if (error) setFailed(true);
        else setItems((data ?? []) as DigestItem[]);
        setLoading(false);
      });
  }, []);

  const groups = new Map<string, DigestItem[]>();
  for (const item of items) {
    const day = DAY.format(new Date(item.published_at));
    groups.set(day, [...(groups.get(day) ?? []), item]);
  }

  return (
    <div className="public-shell">
      <header className="public-header">
        <a className="public-brand" href="/" aria-label="OgniOra, pagina iniziale">Ogni<span>Ora</span><i aria-hidden="true" /></a>
        <nav aria-label="Navigazione principale">
          <a href="#notizie">Notizie</a>
          <a href="https://www.youtube.com/@OgniOra" target="_blank" rel="noopener noreferrer">Video ↗</a>
        </nav>
      </header>
      <main>
        <section className="public-hero">
          <div className="public-hero-inner">
            <p className="public-eyebrow"><span className="live-dot" /> IL PUNTO SULLE NOTIZIE</p>
            <h1>Le notizie, <em>con le fonti.</em></h1>
            <p className="public-lead">Un riepilogo essenziale dei fatti selezionati dalla redazione. Ogni scheda rimanda agli articoli originali, così puoi controllare da dove arriva la notizia.</p>
            <a className="public-primary" href="#notizie">Leggi il riepilogo <span aria-hidden="true">↓</span></a>
          </div>
          <div className="hero-mark" aria-hidden="true">O<span>.</span></div>
        </section>
        <section className="public-news" id="notizie" aria-labelledby="news-title">
          <div className="section-intro">
            <div><p className="public-eyebrow">OGNIORA / AGGIORNAMENTI</p><h2 id="news-title">Il riepilogo</h2></div>
            <p>Le schede compaiono dopo la verifica e la pubblicazione da parte della redazione.</p>
          </div>
          {loading && <p className="public-empty" role="status">Caricamento notizie…</p>}
          {!loading && failed && <p className="public-empty" role="status">Il riepilogo non è disponibile in questo momento.</p>}
          {!loading && !failed && groups.size === 0 && (
            <div className="public-empty">
              <strong>Il primo riepilogo è in preparazione.</strong>
              <p>Intanto trovi gli ultimi aggiornamenti sul canale video.</p>
              <a href="https://www.youtube.com/@OgniOra" target="_blank" rel="noopener noreferrer">Vai a OgniOra su YouTube ↗</a>
            </div>
          )}
          {[...groups].map(([day, stories]) => (
            <section className="digest-day" key={day} aria-label={"Notizie del " + day}>
              <div className="day-label"><span>{day}</span><span>{stories.length} {stories.length === 1 ? "notizia" : "notizie"}</span></div>
              <div className="story-grid">
                {stories.map((item, index) => (
                  <article className="story-card" key={item.id}>
                    <div className="story-top"><span className="story-number">{String(index + 1).padStart(2, "0")}</span><span className="story-category">{item.category ?? "Attualità"}</span></div>
                    <h3>{item.headline}</h3>
                    <p className="story-summary">{item.summary}</p>
                    <div className="story-bottom">
                      <span className="story-time">Pubblicato alle {TIME.format(new Date(item.published_at))}{item.amended_at && " · aggiornato alle " + TIME.format(new Date(item.amended_at))}</span>
                      <div className="story-sources" aria-label="Fonti">
                        <span>FONTI</span>
                        {item.source_links.map((source, sourceIndex) => {
                          const safe = safeHttpsUrl(source.url);
                          return safe ? <a key={item.id + "-" + sourceIndex} href={safe} target="_blank" rel="noopener noreferrer">{source.publisher} ↗</a> : null;
                        })}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </section>
      </main>
      <footer className="public-footer"><span className="public-brand">Ogni<span>Ora</span><i aria-hidden="true" /></span><p>Notizie essenziali, fonti visibili.</p><a href="/studio">Studio</a></footer>
    </div>
  );
}
