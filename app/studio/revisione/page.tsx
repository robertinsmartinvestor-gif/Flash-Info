"use client";

import { useCallback, useEffect, useState } from "react";
import { buildReviewItems, canApprove, canReject, type ReviewItem, safeHttpsUrl } from "@/src/editorial/review";
import { button, field, small, useStudio } from "../shared";

const STATUS_LABEL: Record<string, string> = {
  draft: "Bozza",
  in_review: "Da rivedere",
  blocked: "Bloccato dal QC",
  approved: "Approvato",
  rejected: "Respinto",
};

const VERSION_FIELDS = "id, script_id, version, content, narration, estimated_seconds, evidence, qc_verdict, qc_report, created_at";

interface MediaState {
  job?: { status: string; error_code: string | null };
  path?: string;
}

interface PublicationState {
  id: string;
  status: string;
  last_error: string | null;
  youtubeId?: string;
}

type Production = Partial<Record<"tts" | "render", MediaState>> & { publication?: PublicationState };

const PUBLICATION_LABEL: Record<string, string> = {
  pending: "In coda come video privato: n8n avvia l'upload entro 10 minuti, oppure avvia a mano Distribution con questo queue_id.",
  scheduled: "In coda come video privato: avvia a mano Distribution con questo queue_id.",
  uploading: "Upload in corso. Se resta così a lungo, controlla YouTube Studio prima di riprovare.",
  uploaded: "Caricato su YouTube come privato.",
  cancelled: "Pubblicazione annullata.",
};

const YOUTUBE_ID = /^[\w-]{11}$/;

function Publication({ item, publication, onDone }: { item: ReviewItem; publication?: PublicationState; onDone: (message: string) => void }) {
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
  return (
    <div style={{ marginTop: 16 }}>
      {!publication && <button type="button" disabled={busy} onClick={enqueue} style={button}>Metti in coda per YouTube (privato)</button>}
      {publication && (
        <p style={small}>
          {publication.status === "failed" ? `Upload non riuscito: ${publication.last_error ?? "errore"}. n8n non riprova da solo: controlla YouTube Studio, poi rilancia Distribution a mano.` : PUBLICATION_LABEL[publication.status] ?? publication.status}
        </p>
      )}
      {publication && !youtubeId && <p style={small}>queue_id: <code>{publication.id}</code></p>}
      {youtubeId && (
        <p style={small}>
          <a href={`https://studio.youtube.com/video/${youtubeId}/edit`} target="_blank" rel="noopener noreferrer">Apri in YouTube Studio</a>
        </p>
      )}
      <p role="status" style={small}>{error}</p>
    </div>
  );
}

const MEDIA = {
  tts: { name: "Audio", action: "Genera audio" },
  render: { name: "Video", action: "Genera video" },
};

function jobLabel(name: string, job: NonNullable<MediaState["job"]>): string {
  if (job.status === "failed") return `${name} non riuscito: ${job.error_code ?? "errore"}.`;
  if (job.status === "queued") return `${name} in coda: n8n avvia Production entro 10 minuti, oppure avvialo a mano su GitHub Actions.`;
  if (job.status === "running") return `${name} in produzione.`;
  if (job.status === "succeeded") return `${name} pronto.`;
  if (job.status === "cancelled") return `Produzione ${name.toLowerCase()} annullata.`;
  return job.status;
}

function Media({ item, kind, media, onDone }: { item: ReviewItem; kind: "tts" | "render"; media: MediaState; onDone: (message: string) => void }) {
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
    if (failed) setError(`Job ${name.toLowerCase()} non creato.`);
    else onDone(`Job ${name.toLowerCase()} in coda.`);
  }

  const { job } = media;
  return (
    <div style={{ marginTop: 16 }}>
      {!job && <button type="button" disabled={busy} onClick={enqueue} style={button}>{action}</button>}
      {job && <p style={small}>{jobLabel(name, job)}</p>}
      {src && kind === "tts" && <audio controls src={src} style={{ width: "100%" }} />}
      {src && kind === "render" && <video controls src={src} style={{ width: "100%", maxWidth: 320, display: "block" }} />}
      <p role="status" style={small}>{error}</p>
    </div>
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
    else onDone(action === "approve" ? "Script approvato." : "Script respinto.");
  }

  const sources = new Map(item.evidence.map((source) => [source.evidenceId, source]));
  const generalFindings = item.findings.filter((finding) => finding.sentence === undefined);

  return (
    <div style={{ padding: "12px 0 20px" }}>
      {item.draft && <p style={{ fontSize: 14, marginTop: 0 }}>{item.draft.summary}</p>}
      <p style={small}>Versione {item.version}, circa {Math.round(item.estimatedSeconds)} secondi, formato {item.format}.</p>

      {generalFindings.map((finding, index) => (
        <p key={index} style={{ ...small, color: finding.severity === "blocker" ? "#b42318" : "#8a5a00" }}>{finding.message}</p>
      ))}

      {item.draft ? (
        <ol style={{ paddingLeft: 20, fontSize: 14, lineHeight: 1.5 }}>
          {item.draft.sentences.map((sentence, index) => (
            <li key={index} style={{ marginBottom: 12 }}>
              {sentence.text}
              {item.findings.filter((finding) => finding.sentence === index).map((finding, position) => (
                <div key={position} style={{ ...small, color: finding.severity === "blocker" ? "#b42318" : "#8a5a00" }}>{finding.message}</div>
              ))}
              {sentence.evidence.map((reference, position) => {
                const source = sources.get(reference.evidenceId);
                const url = safeHttpsUrl(source?.url);
                return (
                  <div key={position} style={small}>
                    {url ? <a href={url} target="_blank" rel="noopener noreferrer">{source?.publisher}</a> : (source?.publisher ?? "Fonte non trovata")}: «{reference.quote}»
                  </div>
                );
              })}
            </li>
          ))}
        </ol>
      ) : (
        <p style={{ fontSize: 14, lineHeight: 1.5 }}>{item.narration}</p>
      )}

      {(canApprove(item) || canReject(item)) && (
        <>
          <label htmlFor={`note-${item.scriptId}`} style={small}>Nota: facoltativa per approvare, obbligatoria per respingere</label>
          <textarea id={`note-${item.scriptId}`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} style={field} />
          <div style={{ display: "flex", gap: 8 }}>
            {canApprove(item) && <button type="button" disabled={busy} onClick={() => decide("approve")} style={button}>Approva</button>}
            {canReject(item) && <button type="button" disabled={busy || !note.trim()} onClick={() => decide("reject")} style={{ ...button, background: "#fff", color: "#b42318", border: "1px solid #b42318", opacity: busy || !note.trim() ? 0.5 : 1 }}>Respingi</button>}
          </div>
        </>
      )}
      <p role="status" style={small}>{error}</p>
      {item.status === "approved" && <Media item={item} kind="tts" media={production.tts ?? {}} onDone={onDone} />}
      {item.status === "approved" && production.tts?.path && <Media item={item} kind="render" media={production.render ?? {}} onDone={onDone} />}
      {item.status === "approved" && production.render?.path && <Publication item={item} publication={production.publication} onDone={onDone} />}
    </div>
  );
}

export default function ReviewPage() {
  const { client } = useStudio();
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [production, setProduction] = useState<Record<string, Production>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const [scripts, versions, jobs, assets, queue, uploads] = await Promise.all([
      client.from("scripts").select("id, status, format").order("created_at", { ascending: false }).limit(50),
      client.from("script_versions").select(VERSION_FIELDS).order("created_at", { ascending: false }).limit(200),
      client.from("production_jobs").select("script_version_id, kind, status, error_code").in("kind", ["tts", "render"]).limit(200),
      client.from("media_assets").select("script_version_id, kind, storage_path").in("kind", ["audio", "video"]).is("deleted_at", null).order("created_at").limit(200),
      client.from("publication_queue").select("id, script_version_id, status, last_error").limit(200),
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
      next[row.script_version_id] = { ...next[row.script_version_id], publication: { id: row.id, status: row.status, last_error: row.last_error, youtubeId: videoIds.get(row.id) } };
    }
    setProduction(next);
    setItems(buildReviewItems(scripts.data, versions.data));
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!items) return <p style={small}>Caricamento…</p>;

  return (
    <>
      <p style={small}>Approvare non pubblica nulla: rende lo script utilizzabile per la produzione.</p>
      {items.length === 0 && !message && <p style={small}>Nessuno script.</p>}
      {items.map((item) => (
        <section key={item.scriptId} style={{ borderTop: "1px solid #e5e5e5" }}>
          <button
            type="button"
            aria-expanded={open === item.scriptId}
            onClick={() => setOpen(open === item.scriptId ? null : item.scriptId)}
            style={{ width: "100%", textAlign: "left", background: "none", border: "none", padding: "12px 0", cursor: "pointer", fontSize: 14 }}
          >
            <strong>{item.draft?.title ?? "Script senza titolo"}</strong>
            <span style={{ ...small, display: "block" }}>
              {STATUS_LABEL[item.status] ?? item.status}, {item.findings.length} {item.findings.length === 1 ? "avviso" : "avvisi"}
            </span>
          </button>
          {open === item.scriptId && (
            <Detail
              key={item.versionId + item.status}
              item={item}
              production={production[item.versionId] ?? {}}
              onDone={(text) => {
                setMessage(text);
                void load();
              }}
            />
          )}
        </section>
      ))}
      <p role="status" style={{ ...small, marginTop: 16 }}>{message}</p>
    </>
  );
}
