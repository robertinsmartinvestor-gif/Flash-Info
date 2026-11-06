import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

const MIN_SECRET_LENGTH = 16;

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/**
 * Bearer check that fails closed: with an unset or weak secret nobody is
 * authorized. The previous check compared against `Bearer ${undefined}`, so an
 * unset CRON_SECRET accepted the literal header "Bearer undefined".
 */
export function isAuthorizedBearer(header: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < MIN_SECRET_LENGTH || !header) return false;
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
}

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

/**
 * Fixed-window limiter. State lives in one serverless instance, so this is a
 * brake against runaway loops, not a global quota: the hard cost limits are the
 * provider quotas and, from phase B on, the `provider_usage` budget guard.
 */
export function allowRequest(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= limit;
}

export function resetRateLimits(): void {
  buckets.clear();
}

/** Runs the shared checks for cost-bearing routes; returns a response when the request must stop. */
export function guardCostlyRoute(req: Request, route: string): NextResponse | null {
  if (!isAuthorizedBearer(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!allowRequest(route, 10, 60 * 60 * 1000)) {
    return NextResponse.json({ ok: false, error: "Too many requests" }, { status: 429 });
  }
  return null;
}

/** Logs the failure class server-side and returns a message that exposes no provider detail. */
export function internalError(route: string, err: unknown): NextResponse {
  const name = err instanceof Error ? err.name : "UnknownError";
  console.error(`[${route}] request failed: ${name}`);
  return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
}
