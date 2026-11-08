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

/**
 * The only qualifiers a cover may carry. A closed list: the model picks one or
 * none, it cannot invent a new degree of certainty.
 */
export const COVER_QUALIFIERS = ["", "PER ORA", "IN ATTESA", "NON CONFERMATO", "SECONDO LE FONTI"] as const;

/** Original vector illustrations drawn by the cover template: no photos, no third-party images. */
export const COVER_VISUALS = [
  "carburante", "economia", "politica", "esteri", "giustizia", "salute", "meteo", "trasporti", "lavoro", "tecnologia", "ambiente", "generico",
] as const;

export const coverSchema = z.object({
  headline: z.string(),
  qualifier: z.enum(COVER_QUALIFIERS),
  subline: z.string(),
  visual: z.enum(COVER_VISUALS),
  evidence: z.array(evidenceRefSchema),
});

export type Cover = z.infer<typeof coverSchema>;

const draftFields = {
  title: z.string(),
  summary: z.string(),
  tags: z.array(z.string()),
  sentences: z.array(sentenceSchema),
};

/** What the model must return: every new draft carries its cover. */
export const scriptDraftSchema = z.object({ ...draftFields, cover: coverSchema });

/** What may be stored: versions saved before covers existed have none. */
export const storedDraftSchema = z.object({ ...draftFields, cover: coverSchema.optional() });

export type ScriptDraft = z.infer<typeof storedDraftSchema>;
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
