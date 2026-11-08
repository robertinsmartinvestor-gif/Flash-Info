import { createHash } from "node:crypto";
import { z } from "zod";
import { foldText } from "@/src/core/text";
import { COVER_QUALIFIERS, COVER_VISUALS, type ScriptDraft } from "@/src/editorial/schema";
import { FRAME } from "./render-spec";

export const COVER_TEMPLATE = "cover-v1";

const plainText = (max: number) => z.string().max(max).refine((value) => !/[<>]|https?:|javascript:/i.test(value), "must be plain text");

/**
 * Everything the cover template may receive: validated plain text, rendered as
 * React text, never as markup. Text and brand are composed by code, so they are
 * exact; no model draws letters.
 */
export const coverSpecSchema = z.object({
  template: z.literal(COVER_TEMPLATE),
  frame: z.object({ width: z.literal(1080), height: z.literal(1920) }),
  headline: plainText(100).refine((value) => value.trim().length > 0, "headline required"),
  qualifier: z.enum(COVER_QUALIFIERS),
  subline: plainText(80),
  dateLabel: z.string().regex(/^\d{1,2} [A-Z]{3} \d{4}$/),
  sources: z.array(plainText(40)).max(3),
  visual: z.enum(COVER_VISUALS),
  /** Varies colors and composition from one video to the next. */
  seed: z.number().int().min(0).max(0xffffffff),
  /** Where the text came from: the cover the checks passed, or the title of an older version. */
  textSource: z.enum(["cover", "title_fallback"]),
});

export type CoverSpec = z.infer<typeof coverSpecSchema>;

const MONTHS = ["GEN", "FEB", "MAR", "APR", "MAG", "GIU", "LUG", "AGO", "SET", "OTT", "NOV", "DIC"];

/** "8 NOV 2026" in Rome time. */
export function coverDateLabel(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "numeric", day: "numeric" }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return `${get("day")} ${MONTHS[get("month") - 1]} ${get("year")}`;
}

/** Older versions have no cover: their theme is guessed from tags and title, "generico" when nothing matches. */
const VISUAL_KEYWORDS: Array<[CoverSpec["visual"], string[]]> = [
  ["carburante", ["gasolio", "benzina", "carburant", "accise", "diesel", "pompa"]],
  ["economia", ["economia", "prezz", "inflazion", "borsa", "tasse", "pil", "banca", "bollett"]],
  ["giustizia", ["tribunal", "giudic", "processo", "sentenza", "corte", "inchiesta", "procura"]],
  ["salute", ["salute", "sanita", "ospedal", "medic", "vaccin", "malatt"]],
  ["meteo", ["meteo", "maltempo", "allerta", "pioggia", "neve", "alluvion", "caldo"]],
  ["trasporti", ["treni", "trasport", "sciopero", "autostrad", "aereo", "voli", "ferrovi"]],
  ["lavoro", ["lavoro", "occupazion", "sindacat", "salari", "pension", "contratt"]],
  ["tecnologia", ["tecnologi", "intelligenza artificiale", "digitale", "internet", "app"]],
  ["ambiente", ["ambiente", "clima", "emission", "energia rinnovabil", "inquinament"]],
  ["esteri", ["ucraina", "russia", "stati uniti", "usa", "cina", "israele", "gaza", "europa", "onu", "nato"]],
  ["politica", ["governo", "parlament", "senato", "camera", "ministr", "elezion", "partit", "regione"]],
];

export function guessVisual(text: string): CoverSpec["visual"] {
  const folded = foldText(text);
  return VISUAL_KEYWORDS.find(([, words]) => words.some((word) => folded.includes(word)))?.[0] ?? "generico";
}

export function coverSeed(versionId: string): number {
  return createHash("sha256").update(versionId).digest().readUInt32BE(0);
}

/** Short publisher names only: they sit in small type under the subline. */
function shortSources(sources: string[]): string[] {
  return sources.map((source) => source.trim()).filter((source) => source.length > 0 && source.length <= 40).slice(0, 3);
}

/**
 * The cover of one approved version. The cover the QC checked is used as it is;
 * an older version without one shows its checked title and no other claim.
 */
export function buildCoverSpec(draft: ScriptDraft, sources: string[], newsDate: Date, versionId: string): CoverSpec {
  const cover = draft.cover;
  return coverSpecSchema.parse({
    template: COVER_TEMPLATE,
    frame: { width: FRAME.width, height: FRAME.height },
    headline: (cover?.headline ?? draft.title).trim(),
    qualifier: cover?.qualifier ?? "",
    subline: cover?.subline.trim() ?? "",
    dateLabel: coverDateLabel(newsDate),
    sources: shortSources(sources),
    visual: cover?.visual ?? guessVisual(`${draft.tags.join(" ")} ${draft.title}`),
    seed: coverSeed(versionId),
    textSource: cover ? "cover" : "title_fallback",
  });
}

export interface RenderedCover {
  path: string;
  width: number;
  height: number;
  sizeBytes: number;
}

/** thumbnails.set accepts up to 50 MB; 2 MB keeps the PNG light in Storage and on upload. */
const MAX_COVER_BYTES = 2 * 1024 * 1024;

export function validateRenderedCover(cover: RenderedCover): string[] {
  const problems: string[] = [];
  if (cover.width !== FRAME.width || cover.height !== FRAME.height) problems.push("wrong_resolution");
  if (cover.sizeBytes === 0) problems.push("empty_file");
  if (cover.sizeBytes > MAX_COVER_BYTES) problems.push("file_too_large");
  return problems;
}

/** Width and height from a PNG header, or null when the bytes are not a PNG. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || signature.some((byte, index) => bytes[index] !== byte)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** Newest publication date among the cited sources: the date the cover shows. */
export function newsDate(evidence: unknown, cited: Set<string>, fallback: Date): Date {
  const parsed = z.array(z.object({ evidenceId: z.string(), publishedAt: z.string() })).safeParse(evidence);
  if (!parsed.success) return fallback;
  const times = parsed.data.filter((item) => cited.has(item.evidenceId)).map((item) => Date.parse(item.publishedAt)).filter(Number.isFinite);
  return times.length ? new Date(Math.max(...times)) : fallback;
}
