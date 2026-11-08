"use client";

import { useCallback, useEffect, useState } from "react";
import { safeHttpsUrl } from "@/src/editorial/review";
import { formatWhen, useStudio } from "../shared";
import { Badge, PageHead, StatusLine } from "../ui";

interface Article {
  title: string;
  summary: string;
  url: string;
  publisher: string;
  news_sources: { group_key: string } | null;
}
interface Event {
  id: string;
  title: string;
  category: string | null;
  last_seen_at: string;
  independent_sources: number;
  news_event_sources: Array<{ news_articles: Article | null }>;
}
interface Candidate {
  id: string;
  event_id: string;
  score: number;
}
interface Published {
  id: string;
  event_id: string;
  headline: string;
  summary: string;
  published_at: string;
  status: string;
}

export default function DigestStudioPage() {
  const { client, role } = useStudio();
  const [candidates, setCandidates] = useState<Array<{ candidate: Candidate; event: Event }>>([]);
  const [published, setPublished] = useState<Published[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [headline, setHeadline] = useState("");
  const [summary, setSummary] = useState("");
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editHeadline, setEditHeadline] = useState("");
  const [editSummary, setEditSummary] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const [candidateRows, publishedRows] = await Promise.all([
      client.from("editorial_candidates").select("id, event_id, score")
        .eq("status", "proposed").eq("format", "flash")
        .gte("created_at", since).order("score", { ascending: false }).limit(30),
      client.from("digest_items").select("id, event_id, headline, summary, published_at, status")
        .order("published_at", { ascending: false }).limit(20),
    ]);
    if (candidateRows.error || publishedRows.error) {
      setMessage("Candidati o riepiloghi non leggibili.");
      return;
    }
    const allCandidates = (candidateRows.data ?? []) as Candidate[];
    const allPublished = (publishedRows.data ?? []) as Published[];
    setPublished(allPublished);
    if (allCandidates.length === 0) { setCandidates([]); return; }
    const events = await client.from("news_events")
      .select("id, title, category, last_seen_at, independent_sources, news_event_sources(news_articles(title, summary, url, publisher, news_sources(group_key)))")
      .in("id", allCandidates.map((row) => row.event_id));
    if (events.error) { setMessage("Fonti dei candidati non leggibili."); return; }
    const byId = new Map(((events.data ?? []) as unknown as Event[]).map((event) => [event.id, event]));
    const used = new Set(allPublished.map((item) => item.event_id));
    setCandidates(allCandidates.flatMap((candidate) => {
      const event = byId.get(candidate.event_id);
      if (!event || used.has(event.id) || Date.parse(event.last_seen_at) < Date.parse(since)) return [];
      const groups = new Set(event.news_event_sources.map((source) => source.news_articles?.news_sources?.group_key).filter(Boolean));
      return groups.size >= 2 ? [{ candidate, event }] : [];
    }));
  }, [client]);

  useEffect(() => { void load(); }, [load]);

  const selected = candidates.find(({ event }) => event.id === chosen);
  const articles = selected?.event.news_event_sources.flatMap(({ news_articles }) => news_articles ?? []) ?? [];
  const valid = headline.trim().length >= 12 && headline.trim().length <= 110
    && summary.trim().length >= 40 && summary.trim().length <= 360;

  async function publish() {
    if (!selected || !valid || !checked || role !== "admin") return;
    setBusy(true);
    setMessage("");
    const { error } = await client.rpc("publish_digest_item", {
      p_event_id: selected.event.id, p_headline: headline.trim(), p_summary: summary.trim(),
    });
    setBusy(false);
    if (error) { setMessage("Pubblicazione non riuscita. Verifica freschezza, fonti e permessi."); return; }
    setMessage("Scheda pubblicata sul sito.");
    setChosen(null); setHeadline(""); setSummary(""); setChecked(false);
    await load();
  }

  async function retract(id: string) {
    if (role !== "admin") return;
    setBusy(true);
    const { error } = await client.rpc("retract_digest_item", { p_item_id: id });
    setBusy(false);
    setMessage(error ? "Ritiro non riuscito." : "Scheda ritirata dal sito.");
    if (!error) await load();
  }

  async function amend() {
    if (!editing || role !== "admin") return;
    setBusy(true);
    const { error } = await client.rpc("amend_digest_item", {
      p_item_id: editing, p_headline: editHeadline.trim(), p_summary: editSummary.trim(),
    });
    setBusy(false);
    setMessage(error ? "Correzione non riuscita." : "Scheda aggiornata.");
    if (!error) { setEditing(null); await load(); }
  }

  return (
    <>
      <PageHead title="Riepilogo per il sito" subtitle="Scegli gli eventi idonei non usati dal pilota. Ogni scheda richiede verifica umana e due gruppi di fonti.">
        <a className="btn ghost small" href="/" target="_blank" rel="noopener noreferrer">Apri il sito ↗</a>
      </PageHead>
      <div className="review">
        <section>
          <h2>Eventi disponibili</h2>
          <p className="muted">Ultime 24 ore · due fonti indipendenti · nessuno script generato.</p>
          <div className="queue">
            {candidates.length === 0 && <p className="empty">Nessun evento disponibile ora.</p>}
            {candidates.map(({ candidate, event }) => (
              <button type="button" key={candidate.id} aria-current={chosen === event.id} onClick={() => {
                setChosen(event.id); setHeadline(""); setSummary(""); setChecked(false); setMessage("");
              }}>
                <strong>{event.title}</strong>
                <span className="meta">{event.category ?? "Attualità"} · {event.independent_sources} fonti · punteggio {candidate.score} · {formatWhen(event.last_seen_at)}</span>
              </button>
            ))}
          </div>
        </section>
        <section className="card">
          {selected ? (
            <>
              <h2>Verifica le fonti</h2>
              <p className="sub">Apri gli articoli originali prima di scrivere. Il testo della scheda deve aggiungere un riepilogo utile, non copiare gli articoli.</p>
              <ul className="list">
                {articles.map((article, index) => {
                  const safe = safeHttpsUrl(article.url);
                  return <li key={index}><div className="main">
                    <div className="title">{safe ? <a href={safe} target="_blank" rel="noopener noreferrer">{article.publisher}: {article.title} ↗</a> : article.publisher}</div>
                    <div className="meta">{article.summary}</div>
                  </div></li>;
                })}
              </ul>
              <div className="field" style={{ marginTop: 20 }}>
                <label htmlFor="digest-headline">Titolo originale (12–110 caratteri)</label>
                <input id="digest-headline" className="input" maxLength={110} value={headline} onChange={(event) => setHeadline(event.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="digest-summary">Sintesi verificata (40–360 caratteri)</label>
                <textarea id="digest-summary" className="textarea" rows={5} maxLength={360} value={summary} onChange={(event) => setSummary(event.target.value)} />
              </div>
              <div className="card" style={{ marginBottom: 14 }}>
                <Badge tone="warn">Anteprima pubblica</Badge>
                <h2 style={{ marginTop: 12 }}>{headline.trim() || "Titolo della notizia"}</h2>
                <p>{summary.trim() || "La sintesi apparirà qui."}</p>
                <p className="muted">Le fonti saranno collegate automaticamente all’evento.</p>
              </div>
              <label className="field" style={{ display: "flex", alignItems: "start", gap: 9 }}>
                <input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} />
                <span>Ho letto le fonti, verificato ogni affermazione e controllato che il testo sia originale.</span>
              </label>
              <button type="button" className="btn primary" disabled={busy || !valid || !checked || role !== "admin"} onClick={() => void publish()}>Pubblica la scheda</button>
              {role !== "admin" && <p className="muted">Solo un admin può pubblicare.</p>}
            </>
          ) : <p className="empty">Scegli un evento per preparare una scheda.</p>}
        </section>
      </div>
      <section className="card" style={{ marginTop: 18 }}>
        <h2>Pubblicazioni recenti</h2>
        {published.length === 0 && <p className="empty">Ancora nessuna scheda.</p>}
        <ul className="list">
          {published.map((item) => <li key={item.id}><div className="main">
            <div className="title">{item.headline}</div><div className="meta">{formatWhen(item.published_at)} · {item.status}</div>
            {editing === item.id && <div style={{ marginTop: 12 }}>
              <label className="field"><span>Correggi il titolo</span><input className="input" maxLength={110} value={editHeadline} onChange={(event) => setEditHeadline(event.target.value)} /></label>
              <label className="field"><span>Correggi la sintesi</span><textarea className="textarea" rows={4} maxLength={360} value={editSummary} onChange={(event) => setEditSummary(event.target.value)} /></label>
              <button type="button" className="btn primary small" disabled={busy || editHeadline.trim().length < 12 || editSummary.trim().length < 40} onClick={() => void amend()}>Salva correzione</button>
              <button type="button" className="btn ghost small" disabled={busy} onClick={() => setEditing(null)}>Annulla</button>
            </div>}
          </div>{item.status === "published" && role === "admin" && editing !== item.id && <div className="actions">
            <button type="button" className="btn ghost small" disabled={busy} onClick={() => { setEditing(item.id); setEditHeadline(item.headline); setEditSummary(item.summary); }}>Correggi</button>
            <button type="button" className="btn ghost small" disabled={busy} onClick={() => void retract(item.id)}>Ritira</button>
          </div>}</li>)}
        </ul>
      </section>
      <StatusLine message={message} />
    </>
  );
}
