/**
 * Who publishes OgniOra. Only the owner can provide these facts: a null value is
 * shown on the site as "da completare" and keeps every public page out of search
 * engines (noindex) until it is filled. Never guess them.
 */
export interface SiteInfo {
  /** Legal name of the publisher (person or company). */
  publisherName: string | null;
  /** Registered address of the publisher. */
  publisherAddress: string | null;
  /** VAT number or tax code, if the publisher is a business; "non applicabile" otherwise. */
  publisherTaxId: string | null;
  /** Person responsible for the editorial content. */
  editorInCharge: string | null;
  /** Court registration of the outlet, or a statement that it is not registered and why. */
  registration: string | null;
  /** Address readers write to for corrections and reports. */
  contactEmail: string | null;
  /** Data controller for the privacy notice. */
  privacyController: string | null;
  /** Hosting provider, server log retention and legal basis, for the privacy notice. */
  hostingNotice: string | null;
}

export const SITE_INFO: SiteInfo = {
  publisherName: null,
  publisherAddress: null,
  publisherTaxId: null,
  editorInCharge: null,
  registration: null,
  contactEmail: null,
  privacyController: null,
  hostingNotice: null,
};

export const SITE_INFO_LABELS: Record<keyof SiteInfo, string> = {
  publisherName: "Editore (nome o ragione sociale)",
  publisherAddress: "Sede dell'editore",
  publisherTaxId: "Partita IVA o codice fiscale",
  editorInCharge: "Responsabile dei contenuti",
  registration: "Registrazione della testata",
  contactEmail: "Email della redazione",
  privacyController: "Titolare del trattamento dei dati",
  hostingNotice: "Hosting, conservazione dei log e base giuridica",
};

export function missingSiteInfo(info: SiteInfo = SITE_INFO): Array<keyof SiteInfo> {
  return (Object.keys(SITE_INFO_LABELS) as Array<keyof SiteInfo>).filter((key) => !info[key]?.trim());
}

export const YOUTUBE_URL = "https://www.youtube.com/@OgniOra";

/** Canonical origin of the public site, without trailing slash. */
export function siteUrl(env: Record<string, string | undefined> = process.env): string {
  const explicit = env.OGNIORA_SITE_URL?.trim();
  if (explicit && /^https:\/\/[a-z0-9.-]+$/i.test(explicit.replace(/\/$/, ""))) return explicit.replace(/\/$/, "");
  const vercel = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel && /^[a-z0-9.-]+$/i.test(vercel)) return `https://${vercel}`;
  return "http://localhost:3000";
}
