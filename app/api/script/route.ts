import { NextRequest, NextResponse } from "next/server";
import { guardCostlyRoute, internalError } from "@/lib/api-guard";
import { generateScript } from "@/lib/claude";
import { scriptRequestSchema } from "@/lib/legacy-schemas";

export async function POST(req: NextRequest) {
  const denied = guardCostlyRoute(req, "script");
  if (denied) return denied;

  const parsed = scriptRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });

  try {
    const script = await generateScript(parsed.data.categoria, parsed.data.numNotizie);
    return NextResponse.json({ ok: true, script });
  } catch (err) {
    return internalError("api/script", err);
  }
}
