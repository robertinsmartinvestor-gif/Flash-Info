import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatRomeDateTime, getPublished, jsonLdScript, listRetractions, newsArticleJsonLd } from "@/src/public/digest";
import { SITE_INFO, siteUrl } from "@/src/public/site-info";
import { SourceLinks, Timestamps } from "../../components";

export const revalidate = 60;

type Params = { params: Promise<{ slug: string }> };

// Pages are rendered on first request and cached; nothing is prerendered at build time.
export function generateStaticParams(): Array<{ slug: string }> {
  return [];
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const { data: item } = await getPublished(slug);
  if (!item) return { title: "Scheda non disponibile", robots: { index: false, follow: true } };
  return {
    title: item.headline,
    description: item.summary,
    alternates: { canonical: `/notizie/${item.slug}` },
    openGraph: {
      type: "article",
      title: item.headline,
      description: item.summary,
      url: `/notizie/${item.slug}`,
      publishedTime: item.publishedAt,
      modifiedTime: item.amendedAt ?? item.publishedAt,
      section: item.category ?? undefined,
    },
    twitter: { card: "summary", title: item.headline, description: item.summary },
  };
}

export default async function StoryPage({ params }: Params) {
  const { slug } = await params;
  const { ok, data: item } = await getPublished(slug);

  if (!item) {
    if (!ok) throw new Error("digest_unavailable");
    const { data: retractions } = await listRetractions(slug);
    const retraction = retractions[0];
    if (!retraction) notFound();
    return (
      <article className="info-page">
        <p className="public-eyebrow">SCHEDA RITIRATA</p>
        <h1>Questa scheda è stata ritirata</h1>
        <p>
          Pubblicata il <time dateTime={retraction.publishedAt}>{formatRomeDateTime(retraction.publishedAt)}</time>,
          ritirata il <time dateTime={retraction.retractedAt}>{formatRomeDateTime(retraction.retractedAt)}</time>.
        </p>
        <p className="notice"><strong>Motivo:</strong> {retraction.note}</p>
        <p>Il contenuto non è più disponibile. Le regole sono descritte nella pagina <Link href="/correzioni">Correzioni</Link>.</p>
      </article>
    );
  }

  const origin = siteUrl();
  return (
    <article className="story-page" aria-labelledby="story-title">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(newsArticleJsonLd(item, origin, SITE_INFO.publisherName)) }} />
      <nav className="breadcrumb" aria-label="Percorso"><Link href="/">Riepilogo</Link> <span aria-hidden="true">/</span> <span>{item.category ?? "Attualità"}</span></nav>
      <h1 id="story-title">{item.headline}</h1>
      <p className="story-lead">{item.summary}</p>
      <Timestamps item={item} long />
      {item.amendedAt && item.amendmentNote && (
        <p className="notice" role="note"><strong>Correzione:</strong> {item.amendmentNote}</p>
      )}
      <section className="story-page-sources" aria-labelledby="sources-title">
        <h2 id="sources-title">Da dove arriva la notizia</h2>
        <p>La scheda è un riepilogo originale della redazione, verificato su questi articoli di testate indipendenti. Per i dettagli leggi le fonti.</p>
        <SourceLinks item={item} />
      </section>
      <p className="story-method">Come scegliamo e verifichiamo le notizie: <Link href="/metodo">metodo</Link>. Hai trovato un errore? <Link href="/contatti">Scrivi alla redazione</Link>.</p>
    </article>
  );
}
