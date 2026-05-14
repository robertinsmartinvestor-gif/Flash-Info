"use client";

import { useState } from "react";

const CATEGORIE = ["Italia", "economia", "esteri", "tecnologia", "sport"];
const VOICES = [
  { id: "pNInz6obpgDQGcFmaJgB", label: "Adam (uomo)" },
  { id: "EXAVITQu4vr4xnSDxMaL", label: "Bella (donna)" },
  { id: "onwK4e9ZLuTAKqWW03F9", label: "Daniel (uomo, profondo)" },
];

export default function Dashboard() {
  const [categoria, setCategoria] = useState("Italia");
  const [numNotizie, setNumNotizie] = useState(5);
  const [voiceId, setVoiceId] = useState(VOICES[0].id);
  const [script, setScript] = useState<any>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [loadingScript, setLoadingScript] = useState(false);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [error, setError] = useState("");

  async function handleGenerateScript() {
    setLoadingScript(true);
    setError("");
    setScript(null);
    setAudioUrl(null);
    try {
      const res = await fetch("/api/script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoria, numNotizie }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      setScript(data.script);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoadingScript(false);
    }
  }

  async function handleGenerateVoiceover() {
    if (!script) return;
    setLoadingAudio(true);
    setError("");
    setAudioUrl(null);
    try {
      const text = [
        script.intro,
        ...script.notizie.map((n: any) => n.testo),
        script.outro,
      ]
        .filter(Boolean)
        .join("\n\n");

      const res = await fetch("/api/voiceover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voiceId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      setAudioUrl(URL.createObjectURL(blob));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoadingAudio(false);
    }
  }

  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 680, margin: "40px auto", padding: "0 24px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 32 }}>
        <span style={{ background: "#e24b4a", color: "#fff", fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 4, letterSpacing: ".07em" }}>● ON AIR</span>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Flash Info Dashboard</h1>
      </div>

      {/* Step 1 */}
      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 14, color: "#555" }}>1 — Genera script</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 10, alignItems: "end" }}>
          <div>
            <label style={{ fontSize: 12, color: "#888", display: "block", marginBottom: 4 }}>Categoria</label>
            <select value={categoria} onChange={(e) => setCategoria(e.target.value)} style={{ width: "100%", padding: "8px 10px", border: "1px solid #ddd", borderRadius: 8, fontSize: 14 }}>
              {CATEGORIE.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: "#888", display: "block", marginBottom: 4 }}>Notizie</label>
            <select value={numNotizie} onChange={(e) => setNumNotizie(Number(e.target.value))} style={{ width: "100%", padding: "8px 10px", border: "1px solid #ddd", borderRadius: 8, fontSize: 14 }}>
              <option value={3}>3 (~45 sec)</option>
              <option value={5}>5 (~75 sec)</option>
              <option value={7}>7 (~100 sec)</option>
            </select>
          </div>
          <button onClick={handleGenerateScript} disabled={loadingScript} style={{ background: "#111", color: "#fff", border: "none", borderRadius: 8, padding: "0 20px", height: 40, fontSize: 14, fontWeight: 600, cursor: loadingScript ? "not-allowed" : "pointer", opacity: loadingScript ? 0.5 : 1 }}>
            {loadingScript ? "..." : "▶ Genera"}
          </button>
        </div>
      </section>

      {error && <div style={{ background: "#fff0f0", borderRadius: 8, padding: "12px 16px", color: "#c00", fontSize: 13, marginBottom: 20 }}>⚠ {error}</div>}

      {script && (
        <div style={{ border: "1px solid #e5e5e5", borderRadius: 12, marginBottom: 28, overflow: "hidden" }}>
          <div style={{ background: "#f9f9f9", padding: "10px 16px", borderBottom: "1px solid #e5e5e5", fontSize: 13, fontWeight: 600 }}>Script generato</div>
          <div style={{ padding: "16px 20px" }}>
            {script.intro && <p style={{ fontSize: 14, color: "#666", fontStyle: "italic", marginBottom: 12, paddingBottom: 12, borderBottom: "1px solid #eee" }}>{script.intro}</p>}
            {script.notizie.map((n: any, i: number) => (
              <div key={i} style={{ paddingBottom: 12, marginBottom: 12, borderBottom: i < script.notizie.length - 1 ? "1px solid #eee" : "none" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#e24b4a", letterSpacing: ".06em", textTransform: "uppercase", marginBottom: 4 }}>
                  {i + 1} · {n.titolo}
                </div>
                <p style={{ fontSize: 14, margin: 0, lineHeight: 1.6 }}>{n.testo}</p>
              </div>
            ))}
            {script.outro && <p style={{ fontSize: 14, color: "#666", fontStyle: "italic", margin: 0 }}>{script.outro}</p>}
          </div>
        </div>
      )}

      {/* Step 2 */}
      <section style={{ opacity: script ? 1 : 0.4 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 14, color: "#555" }}>2 — Genera voiceover</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "end" }}>
          <div>
            <label style={{ fontSize: 12, color: "#888", display: "block", marginBottom: 4 }}>Voce</label>
            <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)} disabled={!script} style={{ width: "100%", padding: "8px 10px", border: "1px solid #ddd", borderRadius: 8, fontSize: 14 }}>
              {VOICES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
          </div>
          <button onClick={handleGenerateVoiceover} disabled={!script || loadingAudio} style={{ background: "#111", color: "#fff", border: "none", borderRadius: 8, padding: "0 20px", height: 40, fontSize: 14, fontWeight: 600, cursor: !script || loadingAudio ? "not-allowed" : "pointer", opacity: !script || loadingAudio ? 0.5 : 1 }}>
            {loadingAudio ? "..." : "🎙 Voiceover"}
          </button>
        </div>

        {audioUrl && (
          <div style={{ marginTop: 16, border: "1px solid #e5e5e5", borderRadius: 12, overflow: "hidden" }}>
            <div style={{ background: "#f9f9f9", padding: "10px 16px", borderBottom: "1px solid #e5e5e5", fontSize: 13, fontWeight: 600 }}>🎧 Anteprima audio</div>
            <div style={{ padding: 16 }}>
              <audio controls src={audioUrl} style={{ width: "100%" }} />
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
