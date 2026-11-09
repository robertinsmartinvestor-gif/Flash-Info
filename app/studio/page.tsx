"use client";

import Link from "next/link";
import { coverage, type Funnel, toFunnel } from "@/src/editorial/funnel";
import { useCallback, useEffect, useState } from "react";
import { formatWhen, usd, useStudio } from "./shared";
import { Badge, PageHead, PRIVACY, Stat, StatusLine, Switch, type Tone, YOUTUBE_ID } from "./ui";

interface Overview {
  articles_24h: number;
  candidates: number;
  scripts_in_review: number;
  scripts_blocked: number;
  jobs_active: number;
  jobs_failed: number;
  publications_pending: number;
  publications_done: number;
}


interface Autopilot {
  enabled?: boolean;
  max_stories_per_day?: number;
  min_gap_hours?: number;
  publish_hours?: string[];
}

interface Activity {
  id: string;
  action: string;
  actor_type: string;
  data: Record<string, unknown> | null;
  created_at: string;
}

interface Video {
  id: string;
  title: string;
  privacy: string;
  at: string;
}

const ACTIVITY: Record<string, { label: string; tone: Tone }> = {
  "candidate.auto_selected": { label: "Notizia scelta dal pilota", tone: "info" },
  "candidate.selected": { label: "Notizia scelta", tone: "info" },
  "script.auto_approved": { label: "Script approvato dal pilota", tone: "ok" },
  "script.approved": { label: "Script approvato", tone: "ok" },
  "script.auto_held": { label: "Script trattenuto per revisione", tone: "warn" },
  "script.rejected": { label: "Script respinto", tone: "neutral" },
  "job.enqueued": { label: "Produzione in coda", tone: "neutral" },
  "job.finished": { label: "Produzione terminata", tone: "neutral" },
  "publication.queued": { label: "Video in coda per YouTube", tone: "info" },
  "publication.public_authorized": { label: "Pubblicazione autorizzata", tone: "accent" },
  "publication.state": { label: "Stato pubblicazione", tone: "neutral" },
  "settings.changed": { label: "Impostazione modificata", tone: "neutral" },
  "settings.tts_voice_changed": { label: "Voce modificata", tone: "neutral" },
};

const KIND: Record<string, string> = { tts: "audio", render: "video" };

function activityDetail(item: Activity): string {
  const data = item.data ?? {};
  if (item.action === "job.enqueued" && typeof data.kind === "string") return KIND[data.kind] ?? data.kind;
  if (item.action === "job.finished") return data.status === "failed" ? `non riuscita${typeof data.error_code === "string" ? `: ${data.error_code}` : ""}` : "riuscita";
  if (item.action === "publication.state" && typeof data.to === "string") return `${data.to}${typeof data.privacy === "string" ? `, ${data.privacy}` : ""}`;
  if (item.action === "settings.changed" && typeof data.field === "string") return `${data.field}: ${JSON.stringify(data.from)} → ${JSON.stringify(data.to)}`;
  if (item.action === "script.auto_held" && Array.isArray(data.checks)) return data.checks.join(", ");
  return "";
}

export default function OverviewPage() {
  const { client, role } = useStudio();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [funnel, setFunnel] = useState<Funnel | null>(null);
  const [funnelMissing, setFunnelMissing] = useState(false);
  const [autopilot, setAutopilot] = useState<Autopilot>({});
  const [budget, setBudget] = useState<number | null>(null);
  const [spend, setSpend] = useState<number | null>(null);
  const [today, setToday] = useState(0);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [videos, setVideos] = useState<Video[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const [stats, settings, spent, picked, log, uploads, funnelStats] = await Promise.all([
      client.from("pipeline_overview").select("*").maybeSingle(),
      client.from("app_settings").select("key, value").in("key", ["autopilot", "budget"]),
      client.rpc("provider_spend_usd"),
      client.from("audit_logs").select("id", { count: "exact", head: true }).eq("action", "candidate.auto_selected").gt("created_at", since),
      client.from("audit_logs").select("id, action, actor_type, data, created_at").order("created_at", { ascending: false }).limit(14),
      client.from("youtube_publications").select("queue_id, youtube_video_id, privacy, created_at").order("created_at", { ascending: false }).limit(6),
      client.from("editorial_funnel_24h").select("*").maybeSingle(),
    ]);
    if (stats.error || settings.error || log.error || uploads.error) setMessage("Alcuni dati non sono leggibili.");
    setOverview((stats.data as Overview | null) ?? null);
    setFunnel(funnelStats.error ? null : toFunnel(funnelStats.data as Record<string, unknown> | null));
    setFunnelMissing(Boolean(funnelStats.error));
    const values = new Map((settings.data ?? []).map((row) => [row.key as string, row.value as Record<string, unknown>]));
    setAutopilot((values.get("autopilot") ?? {}) as Autopilot);
    const cap = values.get("budget")?.monthly_usd;
    setBudget(typeof cap === "number" ? cap : null);
    setSpend(spent.error ? null : Number(spent.data));
    setToday(picked.count ?? 0);
    setActivity((log.data ?? []) as Activity[]);

    const rows = uploads.data ?? [];
    const titles = rows.length
      ? await client.from("publication_queue").select("id, title").in("id", rows.map((row) => row.queue_id as string))
      : { data: [] as Array<{ id: string; title: string }> };
    const byId = new Map((titles.data ?? []).map((row) => [row.id as string, row.title as string]));
    setVideos(rows.flatMap((row) => (YOUTUBE_ID.test(row.youtube_video_id as string)
      ? [{ id: row.youtube_video_id as string, title: byId.get(row.queue_id as string) ?? "Video", privacy: row.privacy as string, at: row.created_at as string }]
      : [])));
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleAutopilot(next: boolean) {
    setBusy(true);
    setMessage("");
    const { error } = await client.rpc("update_setting", { p_key: "autopilot", p_field: "enabled", p_value: next });
    setBusy(false);
    if (error) setMessage("Pilota non aggiornato.");
    else {
      setAutopilot((current) => ({ ...current, enabled: next }));
      setMessage(next ? "Pilota automatico acceso." : "Pilota automatico spento: nessun nuovo giro produrrà o pubblicherà.");
    }
  }

  const share = spend !== null && budget ? Math.min(1, spend / budget) : 0;
  const meterTone = share >= 0.9 ? "bad" : share >= 0.7 ? "warn" : "";
  const enabled = autopilot.enabled === true;

  return (
    <>
      <PageHead title="Panoramica" subtitle="Cosa sta facendo OgniOra adesso.">
        <button type="button" className="btn ghost small" onClick={() => void load()}>Aggiorna</button>
      </PageHead>

      <div className="grid two" style={{ marginBottom: 16 }}>
        <section className="card">
          <div className="card-head">
            <div>
              <h2>Pilota automatico</h2>
              <p className="sub" style={{ margin: 0 }}>
                Dalle notizie al video pubblico. Nuove notizie alle{" "}
                {autopilot.publish_hours?.length ? [...autopilot.publish_hours].sort().map((hour) => `${hour}:00`).join(", ") : "– (nessuna ora scelta)"}.
              </p>
            </div>
            <Switch checked={enabled} disabled={busy || role !== "admin"} onChange={toggleAutopilot} label="Pilota automatico" />
          </div>
          <div className="actions">
            <Badge tone={enabled ? "ok" : "bad"}>{enabled ? "Attivo" : "Spento"}</Badge>
            <span className="muted">Notizie nelle ultime 24 ore: <strong>{today}</strong> su {autopilot.max_stories_per_day ?? "–"}, a distanza di {autopilot.min_gap_hours ?? "–"} ore.</span>
          </div>
          <p className="faint" style={{ marginTop: 10 }}><Link href="/studio/impostazioni">Cambia le regole</Link></p>
        </section>

        <section className="card">
          <h2>Spesa del mese</h2>
          <p className="sub">Script e voce, stima dai costi dei provider.</p>
          <div className="stat"><div className="value">{spend === null ? "–" : usd(spend)} <span className="muted" style={{ fontSize: 15, fontWeight: 500 }}>su {budget === null ? "–" : usd(budget)}</span></div></div>
          <div className={`meter ${meterTone}`}><span style={{ width: `${Math.round(share * 100)}%` }} /></div>
          <p className="faint">{share >= 1 ? "Tetto raggiunto: script e audio sono fermi fino al mese prossimo." : `${Math.round(share * 100)}% del tetto.`}</p>
        </section>
      </div>

      <div className="grid stats" style={{ marginBottom: 16 }}>
        <Stat label="Articoli 24h" value={overview?.articles_24h ?? "–"} />
        <Stat label="Candidati" value={overview?.candidates ?? "–"} hint="in attesa di scelta" />
        <Stat label="Da rivedere" value={overview?.scripts_in_review ?? "–"} hint={<Link href="/studio/revisione">apri Revisione</Link>} />
        <Stat label="In produzione" value={overview?.jobs_active ?? "–"} hint={overview?.jobs_failed ? `${overview.jobs_failed} non riusciti` : "nessun errore"} />
        <Stat label="Video caricati" value={overview?.publications_done ?? "–"} hint={overview?.publications_pending ? `${overview.publications_pending} in coda` : "nessuno in coda"} />
      </div>

      <FunnelCard funnel={funnel} missing={funnelMissing} />

      <div className="grid two">
        <section className="card">
          <div className="card-head">
            <h2>Ultimi video</h2>
            <Link className="faint" href="/studio/pubblicazioni">Tutti</Link>
          </div>
          {videos.length === 0 && <p className="empty">Nessun video ancora.</p>}
          <ul className="list">
            {videos.map((video) => (
              <li key={video.id}>
                <div className="main">
                  <a className="title" href={`https://www.youtube.com/watch?v=${video.id}`} target="_blank" rel="noopener noreferrer">{video.title}</a>
                  <div className="meta">{formatWhen(video.at)}</div>
                </div>
                <Badge tone={PRIVACY[video.privacy]?.tone}>{PRIVACY[video.privacy]?.label ?? video.privacy}</Badge>
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <h2>Attività</h2>
          <p className="sub">Le ultime decisioni, del pilota e dello staff.</p>
          {activity.length === 0 && <p className="empty">Nessuna attività.</p>}
          <ul className="list">
            {activity.map((item) => {
              const known = ACTIVITY[item.action];
              const detail = activityDetail(item);
              return (
                <li key={item.id}>
                  <div className="main">
                    <div><Badge tone={known?.tone}>{known?.label ?? item.action}</Badge></div>
                    <div className="meta">{item.actor_type === "system" ? "Pilota automatico" : "Staff"}{detail && ` · ${detail}`}</div>
                  </div>
                  <span className="when">{formatWhen(item.created_at)}</span>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <StatusLine message={message} />
    </>
  );
}

function Since({ since }: { since: string | null }) {
  const { complete } = coverage(since);
  if (complete) return null;
  return <span className="badge warn">{since ? `parziale: dati dal ${new Date(since).toLocaleString("it-IT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : "non disponibile"}</span>;
}

/** Where the news of the last 24 hours ended up, step by step. */
function FunnelCard({ funnel, missing }: { funnel: Funnel | null; missing: boolean }) {
  const value = (n: number | undefined) => (funnel ? n ?? 0 : "–");
  const dropped = funnel ? funnel.dropped_undated + funnel.dropped_out_of_window + funnel.dropped_bad_url + funnel.dropped_duplicate : undefined;
  return (
    <section className="card" style={{ marginBottom: 16 }} aria-labelledby="funnel-title">
      <div className="card-head">
        <div>
          <h2 id="funnel-title">Dove finiscono le notizie · ultime 24 ore</h2>
          <p className="sub">Dalla raccolta dei feed al sito. I contatori segnati «parziale» esistono solo dalla migrazione del riepilogo pubblico.</p>
        </div>
        <Link href="/studio/riepilogo">Prepara il riepilogo</Link>
      </div>
      {missing && <p className="muted">Contatori non leggibili: la migrazione 20261108000600_public_digest non è applicata a questo database.</p>}
      <h3 className="funnel-step">1. Raccolta <Since since={funnel?.drops_since ?? null} /></h3>
      <div className="grid stats">
        <Stat label="Voci lette dai feed" value={value(funnel?.feed_items)} hint={funnel ? `${funnel.ingest_runs} esecuzioni` : undefined} />
        <Stat label="Scartate prima del DB" value={value(dropped)} hint={funnel ? `${funnel.dropped_undated} senza data · ${funnel.dropped_out_of_window} fuori finestra · ${funnel.dropped_bad_url} URL non validi · ${funnel.dropped_duplicate} doppioni` : undefined} />
        <Stat label="Articoli nuovi salvati" value={value(funnel?.new_articles)} />
      </div>
      <h3 className="funnel-step">2. Eventi esclusi <Since since={funnel?.classified_since ?? null} /></h3>
      <div className="grid stats">
        <Stat label="Eventi nuovi" value={value(funnel?.events_seen)} />
        <Stat label="Una sola fonte" value={value(funnel?.single_source)} hint="mai pubblicabili sul sito" />
        <Stat label="Basso valore" value={value(funnel?.low_value)} />
        <Stat label="Esclusi senza motivo registrato" value={value(funnel?.unclassified)} hint="salvati prima della migrazione" />
      </div>
      <h3 className="funnel-step">3. Candidati e controlli</h3>
      <div className="grid stats">
        <Stat label="Idonei non scelti" value={value(funnel?.eligible_unselected)} hint="da valutare per il sito" />
        <Stat label="Script bloccati dal QC" value={value(funnel?.scripts_blocked)} hint="mai sul sito" />
        <Stat label="Script trattenuti dal pilota" value={value(funnel?.scripts_held)} hint="rilievi in hold_checks" />
        <Stat label="Schede pubblicate sul sito" value={value(funnel?.digest_published)} />
      </div>
    </section>
  );
}
