import { NextRequest, NextResponse } from "next/server";
import { guardCostlyRoute, internalError } from "@/lib/api-guard";
import { voiceoverRequestSchema } from "@/lib/legacy-schemas";
import { generateVoiceover, isAllowedVoice } from "@/lib/tts";

export async function POST(req: NextRequest) {
  const denied = guardCostlyRoute(req, "voiceover");
  if (denied) return denied;

  const parsed = voiceoverRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
  const { text, voiceId } = parsed.data;
  if (voiceId && !isAllowedVoice(voiceId)) {
    return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
  }

  try {
    const audioBuffer = await generateVoiceover(text, voiceId);
    return new NextResponse(audioBuffer, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Disposition": 'attachment; filename="flash.mp3"',
      },
    });
  } catch (err) {
    return internalError("api/voiceover", err);
  }
}
