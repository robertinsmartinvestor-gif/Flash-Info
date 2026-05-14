import { NextRequest, NextResponse } from "next/server";
import { generateScript, scriptToText } from "@/lib/claude";
import { generateVoiceover } from "@/lib/elevenlabs";

// Protegge il cron da chiamate non autorizzate
function isAuthorized(req: NextRequest) {
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const categoria = process.env.NEWS_CATEGORIA || "Italia";
  const numNotizie = parseInt(process.env.NEWS_NUM || "5");
  const timestamp = new Date().toISOString();

  console.log(`[CRON ${timestamp}] Avvio flash info — ${categoria}`);

  try {
    // Step 1: genera script
    console.log("[CRON] Generazione script...");
    const script = await generateScript(categoria, numNotizie);
    const text = scriptToText(script);
    console.log(`[CRON] Script pronto (${text.split(" ").length} parole)`);

    // Step 2: genera voiceover
    console.log("[CRON] Generazione voiceover...");
    const audioBuffer = await generateVoiceover(text);
    console.log(`[CRON] Audio pronto (${audioBuffer.length} bytes)`);

    // Step 3: qui puoi aggiungere upload YouTube, salvataggio su S3, ecc.
    // await uploadToYouTube(audioBuffer, script);

    return NextResponse.json({
      ok: true,
      timestamp,
      categoria,
      notizie: script.notizie.length,
      audioBytes: audioBuffer.length,
      note: "Step 3 (upload YouTube) da implementare",
    });
  } catch (err: any) {
    console.error(`[CRON] Errore:`, err.message);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
