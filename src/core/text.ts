import { createHash } from "node:crypto";

const STOPWORDS = new Set(
  `a ad al alla alle allo ai agli anche ancora che chi ci come con contro così cui da dai dal dalla dalle dallo degli dei del della delle dello di dopo due e è ed era essere fa fra già gli ha hanno ho i il in la le lo l loro ma mentre mi ne nei nel nella nelle nello no non nuovo nuova o oggi ogni oltre per perché più può quale quando quella quelle quello questa queste questi questo qui se sei senza si sia sono sta su sua sue sui sul sulla sulle sullo suo suoi tra tre tutti tutto un una uno va video foto ultima ora news live`.split(" "),
);

/** Lowercases and strips accents so that comparisons ignore typography. */
export function foldText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’‘`´]/g, "'")
    .replace(/[“”«»]/g, '"')
    .replace(/[–—]/g, "-")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Light Italian stemmer: enough to match governo/governi and riforma/riforme. */
function stem(token: string): string {
  if (token.length <= 4) return token;
  return token.replace(/(zioni|zione)$/, "zion").replace(/[aeio]$/, "");
}

export function tokenize(text: string): string[] {
  return foldText(text)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token))
    .map(stem);
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&#39;": "'", "&nbsp;": " ",
  "&egrave;": "è", "&eacute;": "é", "&agrave;": "à", "&ograve;": "ò", "&ugrave;": "ù", "&igrave;": "ì",
  "&rsquo;": "'", "&lsquo;": "'", "&ldquo;": '"', "&rdquo;": '"', "&ndash;": "-", "&mdash;": "-", "&hellip;": "...",
};

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&[a-z]+;|&#39;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? " ");
}

/**
 * Turns untrusted feed markup into plain text. Output is only ever data for
 * prompts and the database, but it must carry no markup or control characters
 * into later rendering steps.
 */
export function toPlainText(raw: string, maxLength = 1500): string {
  // Decode first as well: feeds often escape their HTML (&lt;p&gt;).
  const text = decodeEntities(raw)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ");
  const decoded = decodeEntities(text)
    .replace(/<[^>]*>/g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return decoded.length <= maxLength ? decoded : `${decoded.slice(0, maxLength).replace(/\s+\S*$/, "")}…`;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}
