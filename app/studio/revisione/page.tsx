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

interface AudioState {
  job?: { status: string; error_code: string | null };
  path?: string;
}

const JOB_LABEL: Record<string, string> = {
  queued: "Audio in coda: avvia il workflow Production su GitHub Actions.",
  running: "Audio in produzione.",
  succeeded: "Audio pronto.",
  cancelled: "Produzione audio annullata.",
};

function Audio({ item, audio, onDone }: { item: ReviewItem; audio: AudioState; onDone: (message: string) => void }) {
  const { client } = useStudio();
  const [src, setSrc] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!audio.path) return;
    void client.storage.from("media").createSignedUrl(audio.path, 600).then(({ data }) => {
      if (data) setSrc(data.signedUrl);
      else setError("Audio non leggibile.");
    });
  }, [client, audio.path]);

  async function enqueue() {
    setBusy(true);
    setError("");
    const { error: failed } = await client.rpc("enqueue_production_job", { p_version_id: item.versionId, p_kind: "tts" });
    setBusy(false);
    if (failed) setError("Job audio non creato.");
    else onDone("Job audio in coda.");
  }

  const { job } = audio;
  return (
    <div style={{ marginTop: 16 }}>
      {!job && <button type="button" disabled={busy} onClick={enqueue} style={button}>Genera audio</button>}
      {job && <p style={small}>{job.status === "failed" ? `Audio non riuscito: ${job.error_code ?? "errore"}.` : JOB_LABEL[job.status] ?? job.status}</p>}
      {src && <audio controls src={src} style={{ width: "100%" }} />}
      <p role="status" style={small}>{error}</p>
    </div>
  );
}

function Detail({ item, audio, onDone }: { item: ReviewItem; audio: AudioState; onDone: (message: string) => void }) {
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
      {item.status === "approved" && <Audio item={item} audio={audio} onDone={onDone} />}
    </div>
  );
}

export default function ReviewPage() {
  const { client } = useStudio();
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [audio, setAudio] = useState<Record<string, AudioState>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const [scripts, versions, jobs, assets] = await Promise.all([
      client.from("scripts").select("id, status, format").order("created_at", { ascending: false }).limit(50),
      client.from("script_versions").select(VERSION_FIELDS).order("created_at", { ascending: false }).limit(200),
      client.from("production_jobs").select("script_version_id, status, error_code").eq("kind", "tts").limit(200),
      client.from("media_assets").select("script_version_id, storage_path").eq("kind", "audio").is("deleted_at", null).order("created_at").limit(200),
    ]);
    if (scripts.error || versions.error || jobs.error || assets.error) {
      setMessage("Script non leggibili.");
      setItems([]);
      return;
    }
    const next: Record<string, AudioState> = {};
    for (const job of jobs.data) next[job.script_version_id] = { job };
    for (const asset of assets.data) next[asset.script_version_id] = { ...next[asset.script_version_id], path: asset.storage_path };
    setAudio(next);
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
              audio={audio[item.versionId] ?? {}}
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
