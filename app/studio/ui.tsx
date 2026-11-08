import type { ReactNode } from "react";

export function PageHead({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children && <div className="actions">{children}</div>}
    </header>
  );
}

export type Tone = "ok" | "warn" | "bad" | "info" | "accent" | "neutral";

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge ${tone === "neutral" ? "" : tone}`}>{children}</span>;
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (next: boolean) => void; disabled?: boolean; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" disabled={disabled} onClick={() => onChange(!checked)} />;
}

export function StatusLine({ message, error }: { message: string; error?: boolean }) {
  return <p role="status" className={`status-line${error ? " error" : ""}`}>{message}</p>;
}

/** Script and publication states, shared by every page. */
export const SCRIPT_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Bozza", tone: "neutral" },
  in_review: { label: "Da rivedere", tone: "warn" },
  blocked: { label: "Bloccato dal QC", tone: "bad" },
  approved: { label: "Approvato", tone: "ok" },
  rejected: { label: "Respinto", tone: "neutral" },
};

export const PUBLICATION_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "In coda", tone: "info" },
  scheduled: { label: "Programmato", tone: "info" },
  uploading: { label: "In caricamento", tone: "warn" },
  processing: { label: "Su YouTube, privato: attende copertina", tone: "warn" },
  finalizing: { label: "Copertina in corso", tone: "warn" },
  uploaded: { label: "Caricato", tone: "ok" },
  failed: { label: "Non riuscito", tone: "bad" },
  cancelled: { label: "Annullato", tone: "neutral" },
};

export const PRIVACY: Record<string, { label: string; tone: Tone }> = {
  public: { label: "Pubblico", tone: "accent" },
  unlisted: { label: "Non in elenco", tone: "neutral" },
  private: { label: "Privato", tone: "neutral" },
};

export const YOUTUBE_ID = /^[\w-]{11}$/;
