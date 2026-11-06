import { randomUUID } from "node:crypto";
import type { EvidenceItem, ScriptDraft } from "@/src/editorial/schema";
import type { Article } from "@/src/news/types";

export const NOW = new Date("2026-11-05T20:00:00Z");

export function article(overrides: Partial<Article> = {}): Article {
  const id = randomUUID();
  return {
    id,
    sourceId: "ansa",
    groupKey: "ansa",
    reliability: 0.9,
    official: false,
    url: `https://news.test/${id}`,
    canonicalUrl: `https://news.test/${id}`,
    title: "Titolo",
    summary: "",
    author: null,
    publisher: "ANSA",
    publishedAt: "2026-11-05T18:00:00.000Z",
    eventAt: null,
    fetchedAt: NOW.toISOString(),
    contentHash: id,
    category: "politica",
    territory: "IT",
    ...overrides,
  };
}

export const PACK: EvidenceItem[] = [
  {
    evidenceId: "E1", articleId: "a1", publisher: "ANSA", groupKey: "ansa",
    title: "Impugnata la legge del Veneto sul fine vita, il governo si divide",
    summary: "Il Consiglio dei ministri ha deciso di impugnare la legge regionale. Salvini non ha partecipato al voto.",
    url: "https://www.ansa.it/a", publishedAt: "2026-11-05T17:00:00.000Z",
  },
  {
    evidenceId: "E2", articleId: "a2", publisher: "Rai", groupKey: "rai",
    title: "Il governo impugna la legge del Veneto sul fine vita",
    summary: "Secondo il presidente Zaia la scelta della Regione era giusta. La legge era stata approvata 3 mesi fa.",
    url: "https://www.rainews.it/b", publishedAt: "2026-11-05T17:30:00.000Z",
  },
];

/** A draft that respects every rule, sized for the Flash format. */
export function validDraft(): ScriptDraft {
  const topics = [
    "la competenza delle regioni sulle scelte di fine vita resta il punto centrale del confronto istituzionale aperto",
    "adesso toccherà ai giudici costituzionali stabilire chi possa legiferare su una materia tanto delicata",
    "nel frattempo le associazioni dei pazienti chiedono regole chiare valide allo stesso modo ovunque",
    "dentro la maggioranza restano posizioni differenti che nelle prossime settimane potrebbero pesare sui lavori parlamentari",
    "le opposizioni parlano invece di una forzatura contro l'autonomia riconosciuta agli enti locali dalla carta",
  ];
  const padding = topics.map((text) => ({
    text: text[0]!.toUpperCase() + text.slice(1) + ".",
    kind: "fact" as const,
    evidence: [{ evidenceId: "E1", quote: "Il Consiglio dei ministri ha deciso di impugnare la legge regionale" }],
  }));
  return {
    title: "Fine vita, il governo impugna la legge del Veneto",
    summary: "Il governo ha impugnato la legge regionale.",
    tags: ["fine vita", "veneto", "governo"],
    sentences: [
      { text: "Il Consiglio dei ministri ha deciso di impugnare la legge regionale del Veneto sul fine vita.", kind: "fact", evidence: [{ evidenceId: "E1", quote: "Il Consiglio dei ministri ha deciso di impugnare la legge regionale" }] },
      { text: "Salvini non ha partecipato al voto.", kind: "fact", evidence: [{ evidenceId: "E1", quote: "Salvini non ha partecipato al voto" }] },
      { text: "Secondo il presidente Zaia la scelta della Regione era giusta.", kind: "interpretation", evidence: [{ evidenceId: "E2", quote: "Secondo il presidente Zaia la scelta della Regione era giusta" }] },
      ...padding,
      { text: "Seguiremo gli sviluppi della vicenda.", kind: "connective", evidence: [] },
    ],
  };
}
