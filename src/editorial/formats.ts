export type FormatId = "flash" | "briefing" | "spiega";

export interface FormatConfig {
  id: FormatId;
  label: string;
  minSeconds: number;
  maxSeconds: number;
  eventsPerVideo: number;
  minCitedPublishers: number;
  /** Narration speed used to estimate length before any audio exists. */
  wordsPerSecond: number;
  structure: string;
}

// Durations are editorial defaults, editable here. YouTube's own Shorts limits
// must be rechecked before changing the maximums.
export const FORMATS: Record<FormatId, FormatConfig> = {
  flash: {
    id: "flash", label: "OgniOra Flash", minSeconds: 35, maxSeconds: 60, eventsPerVideo: 1, minCitedPublishers: 2, wordsPerSecond: 2.5,
    structure: "Una notizia. Apertura incisiva ma non sensazionalistica, poi i fatti, il contesto essenziale e una chiusura breve.",
  },
  briefing: {
    id: "briefing", label: "OgniOra Briefing", minSeconds: 60, maxSeconds: 120, eventsPerVideo: 3, minCitedPublishers: 3, wordsPerSecond: 2.5,
    structure: "Tre notizie in ordine di importanza, con transizioni sobrie. Riepilogo finale solo se utile.",
  },
  spiega: {
    id: "spiega", label: "OgniOra Spiega", minSeconds: 90, maxSeconds: 180, eventsPerVideo: 1, minCitedPublishers: 3, wordsPerSecond: 2.4,
    structure: "Approfondimento su una notizia: cosa è successo, perché conta, che cosa non si sa ancora.",
  },
};
