"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { safeHttpsUrl } from "@/src/editorial/review";
import { findCopiedText, type SourceText } from "@/src/public/originality";
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
interface CandidateRow {
  id: string;
  event_id: string;
  score: number;
  scripts: Array<{ id: string }> | null;
  news_events: Event;
}
interface Published {
  id: string;
  slug: string;
  event_id: string;
  headline: string;
  summary: string;
  published_at: string;
  amended_at: string | null;
  status: "published" | "retracted";
}

const HEADLINE = { min: 12, max: 110 };
const SUMMARY = { min: 40, max: 360 };
const NOTE = { min: 10, max: 200 };
const within = (text: string, range: { min: number; max: number }) => text.trim().length >= range.min && text.trim().length <= range.max;

/** Maps database refusals to what the editor can do about them. Never shows raw errors. */
function explain(error: { message?: string } | null): string {
  const text = error?.message ?? "";
  if (text.includes("headline_copies_source")) return "Il titolo riprende parole di una fonte: riscrivilo con parole tue.";
  if (text.includes("summary_copies_source")) return "La sintesi riprende una frase di una fonte: riscrivila con parole tue.";
  if (text.includes("two independent source groups")) return "Servono due fonti di gruppi editoriali diversi con link https.";
  if (text.includes("absent or stale")) return "L'evento non è più fresco (oltre 24 ore): non può entrare nel riepilogo.";
  if (text.includes("only unselected")) return "Il pilota ha appena scelto questo evento per un video.";
  if (text.includes("script review path")) return "Esiste già un testo video per questo evento: segue la revisione degli script.";
  if (text.includes("admin access")) return "Solo un admin può farlo.";
  if (text.includes("note")) return "Scrivi una nota pubblica di 10–200 caratteri.";
  if (text.includes("duplicate key")) return "Esiste già una scheda per questo evento.";
  if (text.includes("not found")) return "La scheda non è più pubblicata.";
  return "Operazione non riuscita. Riprova o ricarica la pagina.";
}

function Counter({ value, range }: { value: string; range: { min: number; max: number } }) {
  const length = value.trim().length;
  const ok = length >= range.min && length <= range.max;
  return <span className={ok ? "muted" : "warn-text"}>{length}/{range.max}{length < range.min ? ` · minimo ${range.min}` : ""}</span>;
}

export default function DigestStudioPage() {
  const { client, role } = useStudio();
  const isAdmin = role === "admin";
  const [candidates, setCandidates] = useState<Array<{ candidate: CandidateRow; event: Event }>>([]);
  const [published, setPublished] = useState<Published[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [headline, setHeadline] = useState("");
  const [summary, setSummary] = useState("");
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ id: string; mode: "amend" | "retract" } | null>(null);
  const [editHeadline, setEditHeadline] = useState("");
  const [editSummary, setEditSummary] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const [candidateRows, publishedRows] = await Promise.all([
      client.from("editorial_candidates")
        .select("id, event_id, score, scripts(id), news_events!inner(id, title, category, last_seen_at, independent_sources, news_event_sources(news_articles(title, summary, url, publisher, news_sources(group_key))))")
        .eq("status", "proposed").eq("format", "flash")
        .gte("news_events.last_seen_at", since)
        .order("score", { ascending: false }).limit(40),
      client.from("digest_items").select("id, slug, event_id, headline, summary, published_at, amended_at, status")
        .order("published_at", { ascending: false }).limit(30),
    ]);
    if (candidateRows.error || publishedRows.error) {
      setFailed(true);
      setMessage("Candidati o schede non leggibili. La migrazione del riepilogo è applicata?");
      return;
    }
    const allPublished = (publishedRows.data ?? []) as Published[];
    setPublished(allPublished);
    const used = new Set(allPublished.map((item) => item.event_id));
    setCandidates(((candidateRows.data ?? []) as unknown as CandidateRow[]).flatMap((candidate) => {
      const event = candidate.news_events;
      if (used.has(event.id) || (candidate.scripts?.length ?? 0) > 0) return [];
      const groups = new Set(event.news_event_sources
        .filter((link) => safeHttpsUrl(link.news_articles?.url))
        .map((link) => link.news_articles?.news_sources?.group_key).filter(Boolean));
      return groups.size >= 2 ? [{ candidate, event }] : [];
    }));
  }, [client]);

  useEffect(() => { void load(); }, [load]);

  /** Clears the public site cache so the change is visible at once (otherwise within a minute). */
  const refreshSite = useCallback(async () => {
    const { data } = await client.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    await fetch("/api/revalidate-digest", { method: "POST", headers: { authorization: `Bearer ${token}` } }).catch(() => undefined);
  }, [client]);

  const selected = candidates.find(({ event }) => event.id === chosen);
  const articles = useMemo(() => selected?.event.news_event_sources.flatMap(({ news_articles }) => news_articles ?? []) ?? [], [selected]);
  const sourceTexts: SourceText[] = useMemo(() => articles.map((article) => ({ title: article.title, summary: article.summary })), [articles]);
  const copies = findCopiedText(headline, summary, sourceTexts);
  const valid = within(headline, HEADLINE) && within(summary, SUMMARY) && copies.length === 0;

  const editingItem = published.find((item) => item.id === editing?.id);
  const [editSources, setEditSources] = useState<SourceText[]>([]);
  const editCopies = editing?.mode === "amend" ? findCopiedText(editHeadline, editSummary, editSources) : [];

  async function startAmend(item: Published) {
    setEditing({ id: item.id, mode: "amend" });
    setEditHeadline(item.headline); setEditSummary(item.summary); setNote(""); setMessage("");
    const { data } = await client.from("news_event_sources").select("news_articles(title, summary)").eq("event_id", item.event_id);
    setEditSources(((data ?? []) as unknown as Array<{ news_articles: SourceText | null }>).flatMap((row) => row.news_articles ?? []));
  }

  async function publish() {
    if (!selected || !valid || !checked || !isAdmin) return;
    setBusy(true);
    setMessage("");
    const { error } = await client.rpc("publish_digest_item", {
      p_event_id: selected.event.id, p_headline: headline.trim(), p_summary: summary.trim(),
    });
    setBusy(false);
    if (error) { setMessage(explain(error)); return; }
    await refreshSite();
    setMessage("Scheda pubblicata sul sito.");
    setChosen(null); setHeadline(""); setSummary(""); setChecked(false);
    await load();
  }

  async function amend() {
    if (!editing || !isAdmin) return;
    setBusy(true);
    const { error } = await client.rpc("amend_digest_item", {
      p_item_id: editing.id, p_headline: editHeadline.trim(), p_summary: editSummary.trim(), p_note: note.trim(),
    });
    setBusy(false);
    if (error) { setMessage(explain(error)); return; }
    await refreshSite();
    setMessage("Correzione pubblicata, con data e nota visibili sulla scheda.");
    setEditing(null);
    await load();
  }

  async function retract() {
    if (!editing || !isAdmin) return;
    setBusy(true);
    const { error } = await client.rpc("retract_digest_item", { p_item_id: editing.id, p_note: note.trim() });
    setBusy(false);
    if (error) { setMessage(explain(error)); return; }
    await refreshSite();
    setMessage("Scheda ritirata: all'indirizzo resta solo l'avviso con data e motivo.");
    setEditing(null);
    await load();
  }

  return (
    <>
      <PageHead title="Riepilogo per il sito" subtitle="Eventi idonei non scelti dal pilota. Ogni scheda richiede la verifica di un admin e due gruppi di fonti.">
        <a className="btn ghost small" href="/" target="_blank" rel="noopener noreferrer">Apri il sito ↗</a>
      </PageHead>
      <div className="review">
        <section aria-labelledby="digest-available">
          <h2 id="digest-available">Eventi disponibili</h2>
          <p className="muted">Visti nelle ultime 24 ore · due gruppi di fonti https · nessun testo video.</p>
          <div className="queue">
            {!failed && candidates.length === 0 && <p className="empty">Nessun evento disponibile ora.</p>}
            {candidates.map(({ candidate, event }) => (
              <button type="button" key={candidate.id} aria-pressed={chosen === event.id} onClick={() => {
                setChosen(event.id); setHeadline(""); setSummary(""); setChecked(false); setMessage("");
              }}>
                <strong>{event.title}</strong>
                <span className="meta">{event.category ?? "Attualità"} · {event.independent_sources} fonti · punteggio {candidate.score} · {formatWhen(event.last_seen_at)}</span>
              </button>
            ))}
          </div>
        </section>
        <section className="card" aria-labelledby="digest-editor">
          {selected ? (
            <>
              <h2 id="digest-editor">Verifica le fonti</h2>
              <p className="sub">Apri gli articoli originali prima di scrivere. Titolo e sintesi devono essere tuoi: il sistema rifiuta le frasi riprese dalle fonti.</p>
              <ul className="list">
                {articles.map((article, index) => {
                  const safe = safeHttpsUrl(article.url);
                  return <li key={index}><div className="main">
                    <div className="title">{safe ? <a href={safe} target="_blank" rel="noopener noreferrer">{article.publisher}: {article.title} ↗</a> : <>{article.publisher} (link non https, escluso)</>}</div>
                    <div className="meta">{article.summary}</div>
                  </div></li>;
                })}
              </ul>
              <div className="field" style={{ marginTop: 20 }}>
                <label htmlFor="digest-headline">Titolo originale <Counter value={headline} range={HEADLINE} /></label>
                <input id="digest-headline" className="input" maxLength={HEADLINE.max} value={headline} aria-invalid={copies.some((c) => c.field === "headline")} aria-describedby="digest-copy" onChange={(event) => setHeadline(event.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="digest-summary">Sintesi verificata <Counter value={summary} range={SUMMARY} /></label>
                <textarea id="digest-summary" className="textarea" rows={5} maxLength={SUMMARY.max} value={summary} aria-invalid={copies.some((c) => c.field === "summary")} aria-describedby="digest-copy" onChange={(event) => setSummary(event.target.value)} />
              </div>
              <div id="digest-copy" aria-live="polite">
                {copies.map((copy) => (
                  <p key={copy.field} className="warn-text">{copy.field === "headline" ? "Il titolo" : "La sintesi"} riprende dalla fonte: «{copy.run}». Riscrivi con parole tue.</p>
                ))}
              </div>
              <div className="card" style={{ marginBottom: 14 }}>
                <Badge tone="warn">Anteprima pubblica</Badge>
                <h3 style={{ marginTop: 12 }}>{headline.trim() || "Titolo della notizia"}</h3>
                <p>{summary.trim() || "La sintesi apparirà qui."}</p>
                <p className="muted">Le fonti saranno collegate automaticamente, una per gruppo editoriale.</p>
              </div>
              <label className="field" style={{ display: "flex", alignItems: "start", gap: 9 }}>
                <input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} />
                <span>Ho letto le fonti, verificato ogni affermazione e controllato che il testo sia originale.</span>
              </label>
              <button type="button" className="btn primary" disabled={busy || !valid || !checked || !isAdmin} onClick={() => void publish()}>Pubblica la scheda</button>
              {!isAdmin && <p className="muted">Solo un admin può pubblicare.</p>}
            </>
          ) : <p className="empty" id="digest-editor">Scegli un evento per preparare una scheda.</p>}
        </section>
      </div>
      <section className="card" style={{ marginTop: 18 }} aria-labelledby="digest-recent">
        <h2 id="digest-recent">Schede recenti</h2>
        {!failed && published.length === 0 && <p className="empty">Ancora nessuna scheda.</p>}
        <ul className="list">
          {published.map((item) => <li key={item.id}><div className="main">
            <div className="title">{item.status === "published"
              ? <a href={`/notizie/${item.slug}`} target="_blank" rel="noopener noreferrer">{item.headline} ↗</a>
              : item.headline}</div>
            <div className="meta">
              {formatWhen(item.published_at)}{item.amended_at && ` · corretta ${formatWhen(item.amended_at)}`} · {" "}
              <Badge tone={item.status === "published" ? "ok" : "neutral"}>{item.status === "published" ? "Sul sito" : "Ritirata"}</Badge>
            </div>
            {editing?.id === item.id && editingItem && (
              <div style={{ marginTop: 12 }}>
                {editing.mode === "amend" && <>
                  <div className="field"><label htmlFor="edit-headline">Titolo <Counter value={editHeadline} range={HEADLINE} /></label><input id="edit-headline" className="input" maxLength={HEADLINE.max} value={editHeadline} onChange={(event) => setEditHeadline(event.target.value)} /></div>
                  <div className="field"><label htmlFor="edit-summary">Sintesi <Counter value={editSummary} range={SUMMARY} /></label><textarea id="edit-summary" className="textarea" rows={4} maxLength={SUMMARY.max} value={editSummary} onChange={(event) => setEditSummary(event.target.value)} /></div>
                  {editCopies.map((copy) => <p key={copy.field} className="warn-text">Testo ripreso dalla fonte: «{copy.run}».</p>)}
                </>}
                <div className="field">
                  <label htmlFor="edit-note">{editing.mode === "amend" ? "Nota pubblica di correzione" : "Motivo pubblico del ritiro"} <Counter value={note} range={NOTE} /></label>
                  <input id="edit-note" className="input" maxLength={NOTE.max} value={note} onChange={(event) => setNote(event.target.value)}
                    placeholder={editing.mode === "amend" ? "Es.: corretta la data dell'entrata in vigore." : "Es.: una delle fonti ha smentito la notizia."} />
                </div>
                {editing.mode === "amend"
                  ? <button type="button" className="btn primary small" disabled={busy || !within(editHeadline, HEADLINE) || !within(editSummary, SUMMARY) || !within(note, NOTE) || editCopies.length > 0} onClick={() => void amend()}>Pubblica la correzione</button>
                  : <button type="button" className="btn danger small" disabled={busy || !within(note, NOTE)} onClick={() => void retract()}>Conferma il ritiro</button>}
                <button type="button" className="btn ghost small" disabled={busy} onClick={() => setEditing(null)}>Annulla</button>
              </div>
            )}
          </div>{item.status === "published" && isAdmin && editing?.id !== item.id && <div className="actions">
            <button type="button" className="btn ghost small" disabled={busy} onClick={() => void startAmend(item)}>Correggi</button>
            <button type="button" className="btn ghost small" disabled={busy} onClick={() => { setEditing({ id: item.id, mode: "retract" }); setNote(""); setMessage(""); }}>Ritira…</button>
          </div>}</li>)}
        </ul>
      </section>
      <StatusLine message={message} error={failed} />
    </>
  );
}
