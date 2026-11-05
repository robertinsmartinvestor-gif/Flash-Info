import { beforeEach, describe, expect, it, vi } from "vitest";
import { allowRequest, guardCostlyRoute, internalError, isAuthorizedBearer, resetRateLimits } from "@/lib/api-guard";

const SECRET = "a-sufficiently-long-secret";

describe("isAuthorizedBearer", () => {
  it("fails closed when the secret is unset, empty or weak", () => {
    expect(isAuthorizedBearer("Bearer undefined", undefined)).toBe(false);
    expect(isAuthorizedBearer("Bearer ", "")).toBe(false);
    expect(isAuthorizedBearer("Bearer short", "short")).toBe(false);
  });

  it("accepts only the exact header", () => {
    expect(isAuthorizedBearer(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(isAuthorizedBearer(SECRET, SECRET)).toBe(false);
    expect(isAuthorizedBearer(null, SECRET)).toBe(false);
  });
});

describe("allowRequest", () => {
  beforeEach(resetRateLimits);

  it("stops after the limit and recovers in the next window", () => {
    expect(allowRequest("k", 2, 1000, 0)).toBe(true);
    expect(allowRequest("k", 2, 1000, 1)).toBe(true);
    expect(allowRequest("k", 2, 1000, 2)).toBe(false);
    expect(allowRequest("k", 2, 1000, 1001)).toBe(true);
  });
});

describe("guardCostlyRoute", () => {
  beforeEach(() => {
    resetRateLimits();
    vi.stubEnv("CRON_SECRET", SECRET);
  });

  it("returns 401 without the token and null with it", () => {
    const anonymous = new Request("https://x.test/api/script", { method: "POST" });
    expect(guardCostlyRoute(anonymous, "script")?.status).toBe(401);
    const signed = new Request("https://x.test/api/script", { method: "POST", headers: { authorization: `Bearer ${SECRET}` } });
    expect(guardCostlyRoute(signed, "script")).toBeNull();
  });
});

describe("internalError", () => {
  it("does not leak the original message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = internalError("x", new Error("key sk-secret rejected"));
    expect(await response.text()).not.toContain("sk-secret");
    expect(spy.mock.calls.flat().join(" ")).not.toContain("sk-secret");
    spy.mockRestore();
  });
});
