import { describe, expect, it } from "vitest";
import { buildReviewItems, canApprove, canReject, type ReviewItem, safeHttpsUrl, type ScriptRow, type VersionRow } from "@/src/editorial/review";

const draft = { title: "T", summary: "S", tags: [], sentences: [{ text: "Frase.", kind: "fact", evidence: [] }] };

function version(scriptId: string, number: number, overrides: Partial<VersionRow> = {}): VersionRow {
  return {
    id: `${scriptId}-v${number}`,
    script_id: scriptId,
    version: number,
    content: draft,
    narration: "Frase.",
    estimated_seconds: 30,
    evidence: [],
    qc_verdict: "needs_review",
    qc_report: { findings: [{ check: "x", severity: "warning", message: "m" }] },
    created_at: "2026-11-07T10:00:00Z",
    ...overrides,
  };
}

const script = (id: string, status: string): ScriptRow => ({ id, status, format: "flash" });

describe("buildReviewItems", () => {
  it("keeps only the latest version of each script", () => {
    const [item] = buildReviewItems([script("a", "in_review")], [version("a", 1), version("a", 2)]);
    expect(item?.versionId).toBe("a-v2");
    expect(item?.findings).toHaveLength(1);
  });

  it("puts what needs a person first", () => {
    const items = buildReviewItems(
      [script("a", "approved"), script("b", "blocked"), script("c", "in_review")],
      [version("a", 1), version("b", 1), version("c", 1)],
    );
    expect(items.map((item) => item.scriptId)).toEqual(["c", "b", "a"]);
  });

  it("skips a script with no version and survives malformed stored data", () => {
    const items = buildReviewItems(
      [script("a", "in_review"), script("b", "in_review")],
      [version("a", 1, { content: { title: 1 }, evidence: null, qc_report: null })],
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ draft: null, evidence: [], findings: [], narration: "Frase." });
  });
});

describe("review actions", () => {
  const item = (status: string, qcVerdict: string) => ({ status, qcVerdict }) as ReviewItem;

  it("never offers approval on blocked or already decided scripts", () => {
    expect(canApprove(item("in_review", "needs_review"))).toBe(true);
    expect(canApprove(item("in_review", "blocked"))).toBe(false);
    expect(canApprove(item("blocked", "blocked"))).toBe(false);
    expect(canApprove(item("approved", "pass"))).toBe(false);
    expect(canApprove(item("rejected", "pass"))).toBe(false);
  });

  it("lets an approval be withdrawn", () => {
    expect(canReject(item("approved", "pass"))).toBe(true);
    expect(canReject(item("rejected", "pass"))).toBe(false);
  });
});

describe("safeHttpsUrl", () => {
  it("lets only https through", () => {
    expect(safeHttpsUrl("https://www.ansa.it/a")).toBe("https://www.ansa.it/a");
    expect(safeHttpsUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpsUrl("http://example.com")).toBeNull();
    expect(safeHttpsUrl("not a url")).toBeNull();
    expect(safeHttpsUrl(null)).toBeNull();
  });
});
