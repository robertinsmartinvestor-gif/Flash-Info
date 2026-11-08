"use client";

import { useCallback, useEffect, useState } from "react";
import { buildReviewItems, canApprove, canReject, type ReviewItem, safeHttpsUrl } from "@/src/editorial/review";
import { formatWhen, useStudio } from "../shared";
import { Badge, PageHead, PRIVACY, PUBLICATION_STATUS, SCRIPT_STATUS, StatusLine, YOUTUBE_ID } from "../ui";

const VERSION_FIELDS = "id, script_id, version, content, narration, estimated_seconds, evidence, qc_verdict, qc_report, created_at";

interface MediaState {
  job?: { status: string; error_code: string | null };
  path?: string;
}

interface PublicationState {
  id: string;
  status: string;
  privacy: string;
  last_error: string | null;
  youtubeId?: string;
}

type Production = Partial<Record<"tts" | "render", MediaState>> & { publication?: PublicationState };

const FILTERS = [
  { id: "todo", label: "Da rivedere", match: (item: ReviewItem) => item.status === "in_review" || item.status === "draft" },
  { id: "approved", label: "Approvati", match: (item: ReviewItem) => item.status === "approved" },
  { id: "blocked", label: "Bloccati", match: (item: ReviewItem) => item.status === "blocked" },
  { id: "all", label: "Tutti", match: () => true },
] as const;

type FilterId = (typeof FILTERS)[number]["id"];

const MEDIA = {
  tts: { name: "Audio", action: "Genera audio" },
  render: { name: "Video", action: "Genera video" },
};

type StepState = "done" | "active" | "failed" | "todo";

function jobState(media?: MediaState): StepState {
  if (media?.path) return "done";
  if (media?.job?.status === "failed") return "failed";
  if (media?.job) return "active";
  return "todo";
}

function jobLabel(name: string, media: MediaState): string {
  const job = media.job;
  if (media.path) return `${name} pronto.`;
  if (!job) return `${name} non ancora richiesto.`;
  if (job.status === "failed") return `Non riuscito: ${job.error_code ?? "errore"}.`;
  if (job.status === "queued") return "In coda: il pilota lo produce al prossimo giro.";
  if (job.status === "running") return "In produzione.";
  if (job.status === "cancelled") return "Annullato.";
  return job.status;
}

function Step({ index, title, state, children }: { index: number; title: string; state: StepState; children: React.ReactNode }) {
  return (
    <div className={`step ${state}`}>
      <span className="dot" aria-hidden="true">{state === "done" ? "✓" : state === "failed" ? "!" : index}</span>
      <div>
        <div className="name">{title}</div>
        {children}
      </div>
    </div>
  );
}

function MediaStep({ index, item, kind, media, onDone }: { index: number; item: ReviewItem; kind: "tts" | "render"; media: MediaState; onDone: (message: string) => void }) {
  const { client } = useStudio();
  const [src, setSrc] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { name, action } = MEDIA[kind];

  useEffect(() => {
    if (!media.path) return;
    void client.storage.from("media").createSignedUrl(media.path, 600).then(({ data }) => {
      if (data) setSrc(data.signedUrl);
      else setError(`${name} non leggibile.`);
    });
  }, [client, media.path, name]);

  async function enqueue() {
    setBusy(true);
    setError("");
    const { error: failed } = await client.rpc("enqueue_production_job", { p_version_id: item.versionId, p_kind: kind });
    setBusy(false);
    if (failed) setError(`${name} non messo in coda.`);
    else onDone(`${name} in coda.`);
  }

  return (
    <Step index={index} title={name} state={jobState(media)}>
      <div className="faint">{jobLabel(name, media)}</div>
      {!media.job && !media.path && <button type="button" className="btn small" disabled={busy} onClick={enqueue} style={{ marginTop: 8 }}>{action}</button>}
      {src && kind === "tts" && <audio controls src={src} />}
      {src && kind === "render" && <video controls src={src} />}
      {error && <div className="finding blocker">{error}</div>}
    </Step>
  );
}

function PublicationStep({ item, publication, ready, onDone }: { item: ReviewItem; publication?: PublicationState; ready: boolean; onDone: (message: string) => void }) {
  const { client } = useStudio();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function enqueue() {
    setBusy(true);
    setError("");
    const { error: failed } = await client.rpc("queue_publication", { p_version_id: item.versionId });
    setBusy(false);
    if (failed) setError("Video non messo in coda.");
    else onDone("Video in coda per YouTube, come privato.");
  }

  const youtubeId = publication?.youtubeId && YOUTUBE_ID.test(publication.youtubeId) ? publication.youtubeId : null;
  const state: StepState = youtubeId ? "done" : publication?.status === "failed" ? "failed" : publication ? "active" : "todo";
  const status = publication ? PUBLICATION_STATUS[publication.status] : null;
  const privacy = publication ? PRIVACY[publication.privacy] : null;

  return (
    <Step index={3} title="YouTube" state={state}>
      {publication ? (
        <div className="actions" style={{ marginTop: 4 }}>
          <Badge tone={status?.tone}>{status?.label ?? publication.status}</Badge>
          <Badge tone={privacy?.tone}>{privacy?.label ?? publication.privacy}</Badge>
        </div>
      ) : (
        <div className="faint">{ready ? "Il pilota lo pubblica al prossimo giro se lo script è recente." : "Serve prima il video."}</div>
      )}
      {publication?.status === "failed" && <div className="finding blocker">{publication.last_error ?? "Errore"}: controlla YouTube Studio, poi rilancia Distribution.</div>}
      {youtubeId && (
        <div className="faint" style={{ marginTop: 6 }}>
          <a href={`https://www.youtube.com/watch?v=${youtubeId}`} target="_blank" rel="noopener noreferrer">Guarda</a>
          {" · "}
          <a href={`https://studio.youtube.com/video/${youtubeId}/edit`} target="_blank" rel="noopener noreferrer">YouTube Studio</a>
        </div>
      )}
      {!publication && ready && <button type="button" className="btn ghost small" disabled={busy} onClick={enqueue} style={{ marginTop: 8 }}>Metti in coda come privato</button>}
      {error && <div className="finding blocker">{error}</div>}
    </Step>
  );
}

function Detail({ item, production, onDone }: { item: ReviewItem; production: Production; onDone: (message: string) => void }) {
  const { client } = useStudio();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function decide(action: "approve" | "reject") {
    setBusy(true);
    setError("");
    const text = note.trim();
    const { error: failed } = action === "approve"
      ? await client.rpc("approve_script_version", { p_version_id: item.versionId, p_note: text || null })
      : await client.rpc("reject_script", { p_script_id: item.scriptId, p_reason: text });
    setBusy(false);
    if (failed) setError("Operazione non riuscita.");
    else onDone(action === "approve" ? "Script approvato: il pilota lo produce e lo pubblica al prossimo giro." : "Script respinto.");
  }

  const sources = new Map(item.evidence.map((source) => [source.evidenceId, source]));
  const generalFindings = item.findings.filter((finding) => finding.sentence === undefined);
  const status = SCRIPT_STATUS[item.status];

  return (
    <section className="card detail">
      <div className="actions" style={{ marginBottom: 10 }}>
        <Badge tone={status?.tone}>{status?.label ?? item.status}</Badge>
        <span className="faint">v{item.version} · circa {Math.round(item.estimatedSeconds)} s · {formatWhen(item.createdAt)}</span>
      </div>
      <h2>{item.draft?.title ?? "Script senza titolo"}</h2>
      {item.draft && <p className="muted" style={{ marginTop: 0 }}>{item.draft.summary}</p>}

      {generalFindings.map((finding, index) => <div key={index} className={`finding ${finding.severity}`}>{finding.message}</div>)}

      {item.draft ? (
        <ol className="sentences">
          {item.draft.sentences.map((sentence, index) => (
            <li key={index}>
              {sentence.text}
              {item.findings.filter((finding) => finding.sentence === index).map((finding, position) => (
                <div key={position} className={`finding ${finding.severity}`}>{finding.message}</div>
              ))}
              {sentence.evidence.map((reference, position) => {
                const source = sources.get(reference.evidenceId);
                const url = safeHttpsUrl(source?.url);
                return (
                  <div key={position} className="src">
                    {url ? <a href={url} target="_blank" rel="noopener noreferrer">{source?.publisher}</a> : (source?.publisher ?? "Fonte non trovata")}: «{reference.quote}»
                  </div>
                );
              })}
            </li>
          ))}
        </ol>
      ) : (
        <p style={{ lineHeight: 1.6 }}>{item.narration}</p>
      )}

      {(canApprove(item) || canReject(item)) && (
        <div className="field" style={{ marginTop: 8 }}>
          <label htmlFor={`note-${item.scriptId}`}>Nota</label>
          <textarea id={`note-${item.scriptId}`} className="textarea" rows={2} value={note} placeholder="Facoltativa per approvare, obbligatoria per respingere" onChange={(e) => setNote(e.target.value)} />
          <div className="actions">
            {canApprove(item) && <button type="button" className="btn primary" disabled={busy} onClick={() => decide("approve")}>Approva</button>}
            {canReject(item) && <button type="button" className="btn danger" disabled={busy || !note.trim()} onClick={() => decide("reject")}>Respingi</button>}
          </div>
          {canApprove(item) && <p className="help">Approvare rende lo script pubblicabile: il pilota automatico lo produce e lo carica su YouTube al prossimo giro.</p>}
        </div>
      )}
      {error && <div className="finding blocker">{error}</div>}

      {item.status === "approved" && (
        <div className="steps">
          <MediaStep index={1} item={item} kind="tts" media={production.tts ?? {}} onDone={onDone} />
          {production.tts?.path && <MediaStep index={2} item={item} kind="render" media={production.render ?? {}} onDone={onDone} />}
          <PublicationStep item={item} publication={production.publication} ready={Boolean(production.render?.path)} onDone={onDone} />
        </div>
      )}
    </section>
  );
}

export default function ReviewPage() {
  const { client, refreshCounts } = useStudio();
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [production, setProduction] = useState<Record<string, Production>>({});
  const [filter, setFilter] = useState<FilterId>("todo");
  const [open, setOpen] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const [scripts, versions, jobs, assets, queue, uploads] = await Promise.all([
      client.from("scripts").select("id, status, format").order("created_at", { ascending: false }).limit(50),
      client.from("script_versions").select(VERSION_FIELDS).order("created_at", { ascending: false }).limit(200),
      client.from("production_jobs").select("script_version_id, kind, status, error_code").in("kind", ["tts", "render"]).limit(200),
      client.from("media_assets").select("script_version_id, kind, storage_path").in("kind", ["audio", "video"]).is("deleted_at", null).order("created_at").limit(200),
      client.from("publication_queue").select("id, script_version_id, status, privacy, last_error").limit(200),
      client.from("youtube_publications").select("queue_id, youtube_video_id").limit(200),
    ]);
    if (scripts.error || versions.error || jobs.error || assets.error || queue.error || uploads.error) {
      setMessage("Script non leggibili.");
      setItems([]);
      return;
    }
    const next: Record<string, Production> = {};
    for (const job of jobs.data) {
      const kind = job.kind as "tts" | "render";
      next[job.script_version_id] = { ...next[job.script_version_id], [kind]: { job } };
    }
    for (const asset of assets.data) {
      const kind = asset.kind === "audio" ? "tts" : "render";
      const version = next[asset.script_version_id];
      next[asset.script_version_id] = { ...version, [kind]: { ...version?.[kind], path: asset.storage_path } };
    }
    const videoIds = new Map(uploads.data.map((upload) => [upload.queue_id as string, upload.youtube_video_id as string]));
    for (const row of queue.data) {
      next[row.script_version_id] = {
        ...next[row.script_version_id],
        publication: { id: row.id, status: row.status, privacy: row.privacy, last_error: row.last_error, youtubeId: videoIds.get(row.id) },
      };
    }
    setProduction(next);
    setItems(buildReviewItems(scripts.data, versions.data));
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const active = FILTERS.find((item) => item.id === filter) ?? FILTERS[0];
  const visible = (items ?? []).filter(active.match);
  const selected = visible.find((item) => item.scriptId === open) ?? visible[0] ?? null;

  return (
    <>
      <PageHead title="Revisione" subtitle="Gli script che il pilota non ha potuto approvare da solo, e la loro produzione.">
        <button type="button" className="btn ghost small" onClick={() => void load()}>Aggiorna</button>
      </PageHead>

      <div className="filters" role="group" aria-label="Filtro">
        {FILTERS.map((item) => (
          <button key={item.id} type="button" className="chip" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>
            {item.label}{items && ` · ${items.filter(item.match).length}`}
          </button>
        ))}
      </div>

      {!items && <p className="empty">Caricamento…</p>}
      {items && visible.length === 0 && <section className="card"><p className="empty">Niente qui.</p></section>}

      {selected && (
        <div className="review">
          <div className="queue">
            {visible.map((item) => {
              const status = SCRIPT_STATUS[item.status];
              const blockers = item.findings.filter((finding) => finding.severity === "blocker").length;
              return (
                <button key={item.scriptId} type="button" aria-current={item.scriptId === selected.scriptId} onClick={() => setOpen(item.scriptId)}>
                  <span className="q-title">{item.draft?.title ?? "Script senza titolo"}</span>
                  <span className="q-meta">
                    <Badge tone={status?.tone}>{status?.label ?? item.status}</Badge>
                    {item.findings.length > 0 && <span>{item.findings.length} {item.findings.length === 1 ? "rilievo" : "rilievi"}{blockers ? `, ${blockers} bloccanti` : ""}</span>}
                    <span>{formatWhen(item.createdAt)}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <Detail
            key={selected.versionId + selected.status}
            item={selected}
            production={production[selected.versionId] ?? {}}
            onDone={(text) => {
              setMessage(text);
              refreshCounts();
              void load();
            }}
          />
        </div>
      )}
      <StatusLine message={message} />
    </>
  );
}
