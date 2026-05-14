import { NextRequest, NextResponse } from "next/server";
import { generateVoiceover } from "@/lib/elevenlabs";

export async function POST(req: NextRequest) {
  try {
    const { text, voiceId } = await req.json();
    if (!text) return NextResponse.json({ ok: false, error: "Testo mancante" }, { status: 400 });

    const audioBuffer = await generateVoiceover(text, voiceId);

    return new NextResponse(audioBuffer, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Disposition": 'attachment; filename="flash.mp3"',
      },
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
