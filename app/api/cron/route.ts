import { NextRequest, NextResponse } from "next/server";
import { guardCostlyRoute, internalError } from "@/lib/api-guard";
import { generateScript, scriptToText } from "@/lib/claude";
import { scriptRequestSchema } from "@/lib/legacy-schemas";
import { generateVoiceover } from "@/lib/tts";

export async function GET(req: NextRequest) {
  const denied = guardCostlyRoute(req, "cron");
  if (denied) return denied;

  const config = scriptRequestSchema.safeParse({
    categoria: process.env.NEWS_CATEGORIA || "Italia",
    numNotizie: Number.parseInt(process.env.NEWS_NUM || "5", 10),
  });
  if (!config.success) return internalError("api/cron", new Error("Invalid configuration"));

  const timestamp = new Date().toISOString();
  try {
    const script = await generateScript(config.data.categoria, config.data.numNotizie);
    const audioBuffer = await generateVoiceover(scriptToText(script));
    return NextResponse.json({
      ok: true,
      timestamp,
      categoria: config.data.categoria,
      notizie: script.notizie.length,
      audioBytes: audioBuffer.byteLength,
    });
  } catch (err) {
    return internalError("api/cron", err);
  }
}
