"use client";

import { useEffect, useState } from "react";
import { findVoice, VOICE_CATALOG } from "@/src/media/voices";
import { button, field, small, useStudio } from "../shared";

export default function VoicePage() {
  const { client, role } = useStudio();
  const [saved, setSaved] = useState("");
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void client.from("app_settings").select("value").eq("key", "tts_voice").maybeSingle().then(({ data, error }) => {
      if (error) setMessage("Impostazione non leggibile.");
      const voice = findVoice(data?.value)?.voice ?? "";
      setSaved(voice);
      setChoice(voice);
    });
  }, [client]);

  async function save() {
    const option = VOICE_CATALOG.find((item) => item.voice === choice);
    if (!option) return;
    setBusy(true);
    setMessage("");
    const { error } = await client.rpc("set_tts_voice", { p_provider: option.provider, p_voice: option.voice });
    if (error) {
      setMessage("Salvataggio non riuscito.");
    } else {
      setSaved(option.voice);
      setMessage("Voce salvata.");
    }
    setBusy(false);
  }

  const selected = VOICE_CATALOG.find((item) => item.voice === choice);
  const isAdmin = role === "admin";
  const unchanged = busy || !choice || choice === saved;

  return (
    <>
      <label htmlFor="voice" style={small}>Voce dei prossimi audio</label>
      <select id="voice" value={choice} disabled={!isAdmin} onChange={(e) => setChoice(e.target.value)} style={field}>
        {!saved && <option value="">Nessuna voce valida</option>}
        {VOICE_CATALOG.map((option) => <option key={option.voice} value={option.voice}>{option.label}</option>)}
      </select>
      {selected && !selected.verified && <p style={{ ...small, color: "#b42318" }}>Voce mai provata con credenziali reali: la produzione può fallire finché non c&apos;è la chiave del provider.</p>}
      {!isAdmin && <p style={small}>Solo un admin può cambiare la voce.</p>}
      {isAdmin && <button type="button" onClick={save} disabled={unchanged} style={{ ...button, opacity: unchanged ? 0.5 : 1 }}>Salva</button>}
      <p role="status" style={{ ...small, marginTop: 16 }}>{message}</p>
    </>
  );
}
