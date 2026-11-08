import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type Node = { name: string; type: string; credentials?: unknown; parameters: Record<string, unknown> };
type Workflow = { name: string; active: boolean; nodes: Node[]; connections: Record<string, { main: Array<Array<{ node: string }>> }> };

const dir = join(process.cwd(), "n8n");
const workflows = readdirSync(dir).map((file) => [file, JSON.parse(readFileSync(join(dir, file), "utf8")) as Workflow] as const);

describe.each(workflows)("%s", (_file, workflow) => {
  it("ships disabled", () => {
    expect(workflow.active).toBe(false);
  });

  it("has connections pointing at existing nodes", () => {
    const names = new Set(workflow.nodes.map((node) => node.name));
    for (const [from, output] of Object.entries(workflow.connections)) {
      expect(names.has(from), from).toBe(true);
      for (const link of output.main.flat()) expect(names.has(link.node), link.node).toBe(true);
    }
  });

  it("contains no embedded secret", () => {
    const text = JSON.stringify(workflow);
    expect(text).not.toMatch(/ghp_|github_pat_|eyJ[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{20,}/);
  });

  it("does not render or run commands", () => {
    expect(workflow.nodes.every((node) => !/executeCommand|ssh/i.test(node.type))).toBe(true);
  });
});

describe("production and upload workflow", () => {
  const workflow = workflows.find(([file]) => file === "ogniora-4-production.json")?.[1];
  const node = (name: string) => workflow?.nodes.find((n) => n.name === name)?.parameters ?? {};

  it("starts uploads only for pending private items, never failed ones", () => {
    const url = String(node("Leggi upload privati in attesa").url);
    expect(url).toContain("status=eq.pending");
    expect(url).toContain("privacy=eq.private");
    expect(url).toContain("publish_at=is.null");
    expect(url).toContain("limit=1");
  });

  it("passes only the queue id to Distribution", () => {
    const body = String(node("Avvia Distribution su GitHub").jsonBody);
    expect(body).toContain('"queue_id"');
    expect(body).not.toMatch(/privacy|public|publish/i);
  });

  it("runs Production in produce mode", () => {
    expect(String(node("Avvia Production su GitHub").jsonBody)).toContain('"mode": "produce"');
  });
});
