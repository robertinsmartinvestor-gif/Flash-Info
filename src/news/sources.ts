import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { NewsSource } from "./types";

const sourceSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{2,64}$/),
  name: z.string().min(1),
  publisher: z.string().min(1),
  homepageUrl: z.url({ protocol: /^https$/ }),
  feedUrl: z.url({ protocol: /^https$/ }),
  groupKey: z.string().min(1),
  reliability: z.number().min(0).max(1),
  defaultCategory: z.string().optional(),
  official: z.boolean().optional(),
});

const fileSchema = z.object({ sources: z.array(sourceSchema).min(1) });

export function loadConfiguredSources(path = join(process.cwd(), "config", "sources.json")): NewsSource[] {
  const { sources } = fileSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  return sources.map((source) => ({ ...source, id: source.slug }));
}
