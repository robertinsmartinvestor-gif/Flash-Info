import { NextRequest, NextResponse } from "next/server";
import { generateScript } from "@/lib/claude";

export async function POST(req: NextRequest) {
  try {
    const { categoria = "Italia", numNotizie = 5 } = await req.json();
    const script = await generateScript(categoria, numNotizie);
    return NextResponse.json({ ok: true, script });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
