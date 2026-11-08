import "./public.css";
import type { Metadata } from "next";
import Link from "next/link";
import { missingSiteInfo, siteUrl, YOUTUBE_URL } from "@/src/public/site-info";

const incomplete = missingSiteInfo().length > 0;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: "OgniOra, le notizie con le fonti", template: "%s · OgniOra" },
  description: "Riepiloghi essenziali delle notizie, verificati dalla redazione con collegamenti alle fonti originali.",
  openGraph: { siteName: "OgniOra", locale: "it_IT", type: "website" },
  // Until the owner fills in who publishes the site, nothing is offered to search engines.
  robots: incomplete ? { index: false, follow: false } : { index: true, follow: true },
};

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="public-shell">
      <a className="skip-link" href="#contenuto">Vai al contenuto</a>
      {incomplete && (
        <p className="preview-banner" role="note">
          Sito in anteprima: alcune informazioni sull’editore sono ancora da completare. <Link href="/chi-siamo">Dettagli</Link>
        </p>
      )}
      <header className="public-header">
        <Link className="public-brand" href="/" aria-label="OgniOra, pagina iniziale">Ogni<span>Ora</span><i aria-hidden="true" /></Link>
        <nav aria-label="Navigazione principale">
          <Link href="/#notizie">Notizie</Link>
          <Link href="/metodo">Metodo</Link>
          <Link href="/chi-siamo">Chi siamo</Link>
          <a href={YOUTUBE_URL} target="_blank" rel="noopener noreferrer">Video<span aria-hidden="true"> ↗</span><span className="sr-only"> (si apre in una nuova scheda)</span></a>
        </nav>
      </header>
      <main id="contenuto" tabIndex={-1}>{children}</main>
      <footer className="public-footer">
        <span className="public-brand" aria-hidden="true">Ogni<span>Ora</span><i /></span>
        <p>Notizie essenziali, fonti visibili.</p>
        <nav aria-label="Informazioni sul sito">
          <Link href="/chi-siamo">Chi siamo</Link>
          <Link href="/metodo">Metodo di verifica</Link>
          <Link href="/correzioni">Correzioni</Link>
          <Link href="/contatti">Contatti</Link>
          <Link href="/privacy">Privacy</Link>
        </nav>
      </footer>
    </div>
  );
}
