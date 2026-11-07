import { afterEach, describe, expect, it, vi } from "vitest";
import { monthlyBudgetUsd } from "@/src/cli/shared";

afterEach(() => vi.unstubAllEnvs());

describe("monthlyBudgetUsd", () => {
  it("uses the default for the empty string GitHub Actions passes when a variable is unset", () => {
    vi.stubEnv("AI_MONTHLY_BUDGET_USD", "");
    expect(monthlyBudgetUsd()).toBe(20);
  });

  it("reads a configured value", () => {
    vi.stubEnv("AI_MONTHLY_BUDGET_USD", "5");
    expect(monthlyBudgetUsd()).toBe(5);
  });

  it("rejects values that would disable the limit", () => {
    vi.stubEnv("AI_MONTHLY_BUDGET_USD", "abc");
    expect(() => monthlyBudgetUsd()).toThrow();
    vi.stubEnv("AI_MONTHLY_BUDGET_USD", "-1");
    expect(() => monthlyBudgetUsd()).toThrow();
  });
});
