import { describe, expect, it } from "vitest";
import { budgetFromEnv, budgetFromSetting } from "@/src/cli/shared";

describe("budgetFromSetting", () => {
  it("reads the cap set in the Studio, zero included", () => {
    expect(budgetFromSetting({ monthly_usd: 12.5 })).toBe(12.5);
    expect(budgetFromSetting({ monthly_usd: 0 })).toBe(0);
  });

  it("ignores a missing or malformed value, so the fallback applies", () => {
    for (const value of [null, {}, { monthly_usd: "5" }, { monthly_usd: -1 }, { monthly_usd: Number.NaN }]) {
      expect(budgetFromSetting(value)).toBeNull();
    }
  });
});

describe("budgetFromEnv", () => {
  it("uses the default for the empty string GitHub Actions passes when a variable is unset", () => {
    expect(budgetFromEnv("")).toBe(20);
    expect(budgetFromEnv(undefined)).toBe(20);
  });

  it("reads a configured value", () => {
    expect(budgetFromEnv("5")).toBe(5);
  });

  it("rejects values that would disable the limit", () => {
    expect(() => budgetFromEnv("abc")).toThrow();
    expect(() => budgetFromEnv("-1")).toThrow();
  });
});
