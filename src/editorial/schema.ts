import { z } from "zod";

/** Kept free of numeric bounds: several providers reject them in structured output schemas. */
export const evidenceRefSchema = z.object({
  evidenceId: z.string(),
  quote: z.string(),
});

export const sentenceSchema = z.object({
  text: z.string(),
  kind: z.enum(["fact", "interpretation", "connective"]),
  evidence: z.array(evidenceRefSchema),
});

export const scriptDraftSchema = z.object({
  title: z.string(),
  summary: z.string(),
  tags: z.array(z.string()),
  sentences: z.array(sentenceSchema),
});

export type ScriptDraft = z.infer<typeof scriptDraftSchema>;
export type ScriptSentence = z.infer<typeof sentenceSchema>;

export const verificationSchema = z.object({
  results: z.array(z.object({
    index: z.number(),
    verdict: z.enum(["supported", "partial", "unsupported"]),
    reason: z.string(),
  })),
});

export type Verification = z.infer<typeof verificationSchema>;

export interface EvidenceItem {
  evidenceId: string;
  articleId: string;
  publisher: string;
  groupKey: string;
  title: string;
  summary: string;
  url: string;
  publishedAt: string;
}
