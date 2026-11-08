"use client";

import { useCallback, useEffect, useState } from "react";
import { formatWhen, useStudio } from "../shared";
import { Badge, PageHead, PRIVACY, PUBLICATION_STATUS, StatusLine, YOUTUBE_ID } from "../ui";

interface Row {
  id: string;
  title: string;
  status: string;
  privacy: string;
  last_error: string | null;
  public_authorized_policy: string | null;
  public_authorized_by: string | null;
  created_at: string;
  youtubeId?: string;
}

const FILTERS = [
  { id: "all", label: "Tutte" },
  { id: "uploaded", label: "Caricate" },
  { id: "waiting", label: "In attesa" },
  { id: "failed", label: "Da controllare" },
] as const;

type Filter = (typeof FILTERS)[number]["id"];

const matches = (row: Row, filter: Filter) =>
  filter === "all"
  || (filter === "uploaded" && row.status === "uploaded")
  || (filter === "waiting" && ["pending", "scheduled", "uploading"].includes(row.status))
  || (filter === "failed" && ["failed", "uploading"].includes(row.status));

export default function PublicationsPage() {
  const { client } = useStudio();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const [queue, uploads] = await Promise.all([
      client.from("publication_queue").select("id, title, status, privacy, last_error, public_authorized_policy, public_authorized_by, created_at").order("created_at", { ascending: false }).limit(100),
      client.from("youtube_publications").select("queue_id, youtube_video_id").limit(200),
    ]);
    if (queue.error || uploads.error) {
      setMessage("Pubblicazioni non leggibili.");
      setRows([]);
      return;
    }
    const ids = new Map(uploads.data.map((row) => [row.queue_id as string, row.youtube_video_id as string]));
    setRows((queue.data as Row[]).map((row) => ({ ...row, youtubeId: ids.get(row.id) })));
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = (rows ?? []).filter((row) => matches(row, filter));

  return (
    <>
      <PageHead title="Pubblicazioni" subtitle="Ogni video messo in coda per YouTube, con il suo stato.">
        <button type="button" className="btn ghost small" onClick={() => void load()}>Aggiorna</button>
      </PageHead>

      <div className="filters" role="group" aria-label="Filtro">
        {FILTERS.map((item) => (
          <button key={item.id} type="button" className="chip" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>
            {item.label}
            {rows && ` · ${rows.filter((row) => matches(row, item.id)).length}`}
          </button>
        ))}
      </div>

      <section className="card">
        {!rows && <p className="empty">Caricamento…</p>}
        {rows && visible.length === 0 && <p className="empty">Nessuna pubblicazione qui.</p>}
        {visible.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Video</th>
                  <th>Stato</th>
                  <th>Visibilità</th>
                  <th className="num">Messo in coda</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => {
                  const youtubeId = row.youtubeId && YOUTUBE_ID.test(row.youtubeId) ? row.youtubeId : null;
                  const status = PUBLICATION_STATUS[row.status];
                  const privacy = PRIVACY[row.privacy];
                  return (
                    <tr key={row.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{row.title}</div>
                        <div className="faint">
                          {youtubeId ? (
                            <>
                              <a href={`https://www.youtube.com/watch?v=${youtubeId}`} target="_blank" rel="noopener noreferrer">Guarda</a>
                              {" · "}
                              <a href={`https://studio.youtube.com/video/${youtubeId}/edit`} target="_blank" rel="noopener noreferrer">YouTube Studio</a>
                            </>
                          ) : (
                            <code>{row.id}</code>
                          )}
                        </div>
                        {row.status === "failed" && row.last_error && <div className="finding blocker">{row.last_error}</div>}
                        {row.status === "uploading" && <div className="finding warning">Fermo in caricamento: controlla YouTube Studio prima di riprovare.</div>}
                      </td>
                      <td><Badge tone={status?.tone}>{status?.label ?? row.status}</Badge></td>
                      <td>
                        <Badge tone={privacy?.tone}>{privacy?.label ?? row.privacy}</Badge>
                        {row.privacy === "public" && <div className="faint">{row.public_authorized_policy === "autopilot" ? "dal pilota" : row.public_authorized_by ? "da un admin" : ""}</div>}
                      </td>
                      <td className="num faint">{formatWhen(row.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <StatusLine message={message} error />
    </>
  );
}
