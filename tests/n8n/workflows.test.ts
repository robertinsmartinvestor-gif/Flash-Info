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
