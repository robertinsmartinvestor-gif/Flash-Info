import Link from "next/link";
import { type DigestItem, formatRomeDateTime, formatRomeTime } from "@/src/public/digest";
import { SITE_INFO_LABELS, type SiteInfo } from "@/src/public/site-info";

export function SourceLinks({ item }: { item: DigestItem }) {
  return (
    <div className="story-sources">
      <span id={`fonti-${item.id}`}>FONTI</span>
      <ul aria-labelledby={`fonti-${item.id}`}>
        {item.sourceLinks.map((source) => (
          <li key={source.url}>
            <a href={source.url} target="_blank" rel="noopener noreferrer nofollow">
              {source.publisher}<span aria-hidden="true"> ↗</span><span className="sr-only"> (articolo originale, si apre in una nuova scheda)</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Timestamps({ item, long = false }: { item: DigestItem; long?: boolean }) {
  const format = long ? formatRomeDateTime : formatRomeTime;
  return (
    <span className="story-time">
      Pubblicato {long ? "il " : "alle "}<time dateTime={item.publishedAt}>{format(item.publishedAt)}</time>
      {item.amendedAt && <> · aggiornato {long ? "il " : "alle "}<time dateTime={item.amendedAt}>{format(item.amendedAt)}</time></>}
    </span>
  );
}

export function StoryCard({ item, index }: { item: DigestItem; index: number }) {
  return (
    <article className="story-card" aria-labelledby={`titolo-${item.id}`}>
      <div className="story-top">
        <span className="story-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
        <span className="story-category">{item.category ?? "Attualità"}</span>
      </div>
      <h3 id={`titolo-${item.id}`}><Link href={`/notizie/${item.slug}`}>{item.headline}</Link></h3>
      <p className="story-summary">{item.summary}</p>
      <div className="story-bottom">
        <Timestamps item={item} />
        <SourceLinks item={item} />
      </div>
    </article>
  );
}

/** A fact only the owner can provide: shown as missing, never guessed. */
export function OwnerFact({ info, field }: { info: SiteInfo; field: keyof SiteInfo }) {
  const value = info[field]?.trim();
  return value ? <>{value}</> : <mark className="owner-missing">[Da completare dal titolare: {SITE_INFO_LABELS[field]}]</mark>;
}

export function InfoPage({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <article className="info-page">
      <p className="public-eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      {children}
    </article>
  );
}
