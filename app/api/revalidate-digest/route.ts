import { revalidatePath, revalidateTag } from "next/cache";
import { DIGEST_CACHE_TAG } from "@/src/public/digest";

/**
 * Lets the Studio refresh the public pages right after a publish, correction or
 * retraction. The caller must be a signed-in admin: the bearer token is checked
 * by Supabase itself, through the admin_users row the user may read (RLS own_row).
 * The route only clears cache; it cannot change any content.
 */
export async function POST(request: Request): Promise<Response> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const token = request.headers.get("authorization")?.match(/^Bearer ([\w.-]{20,4096})$/)?.[1];
  if (!url || !key || !token) return Response.json({ ok: false }, { status: 401 });

  const check = await fetch(`${url.replace(/\/$/, "")}/rest/v1/admin_users?select=role&limit=1`, {
    headers: { apikey: key, authorization: `Bearer ${token}` },
    cache: "no-store",
  }).catch(() => null);
  if (!check?.ok) return Response.json({ ok: false }, { status: 401 });
  const rows = (await check.json().catch(() => [])) as Array<{ role?: string }>;
  if (rows[0]?.role !== "admin") return Response.json({ ok: false }, { status: 403 });

  revalidateTag(DIGEST_CACHE_TAG, { expire: 0 });
  revalidatePath("/", "layout");
  return Response.json({ ok: true });
}
