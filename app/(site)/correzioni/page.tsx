import type { Metadata } from "next";
import Link from "next/link";
import { formatRomeDateTime, listPublished, listRetractions } from "@/src/public/digest";
import { InfoPage } from "../components";

export const metadata: Metadata = { title: "Correzioni", alternates: { canonical: "/correzioni" } };
export const revalidate = 60;

export default async function CorrectionsPage() {
  const [published, retracted] = await Promise.all([listPublished(500), listRetractions()]);
  const amended = published.data.filter((item) => item.amendedAt && item.amendmentNote)
    .sort((a, b) => (b.amendedAt ?? "").localeCompare(a.amendedAt ?? ""));
  return (
    <InfoPage eyebrow="OGNIORA / CORREZIONI" title="Correzioni e ritiri">
      <p>Quando una scheda contiene un errore la correggiamo sulla stessa pagina, con la data e una nota che spiega cosa è cambiato. Quando una notizia si rivela infondata o non più verificabile la ritiriamo: il testo viene rimosso e all’indirizzo resta un avviso con data e motivo.</p>
      <h2>Schede corrette</h2>
      {!published.ok && <p role="status">Elenco non disponibile in questo momento.</p>}
      {published.ok && amended.length === 0 && <p>Nessuna correzione finora.</p>}
      <ul className="log">
        {amended.map((item) => (
          <li key={item.id}>
            <Link href={`/notizie/${item.slug}`}>{item.headline}</Link>
            <span><time dateTime={item.amendedAt!}>{formatRomeDateTime(item.amendedAt!)}</time>: {item.amendmentNote}</span>
          </li>
        ))}
      </ul>
      <h2>Schede ritirate</h2>
      {!retracted.ok && <p role="status">Elenco non disponibile in questo momento.</p>}
      {retracted.ok && retracted.data.length === 0 && <p>Nessun ritiro finora.</p>}
      <ul className="log">
        {retracted.data.map((item) => (
          <li key={item.slug}>
            <Link href={`/notizie/${item.slug}`}>Scheda del {formatRomeDateTime(item.publishedAt)}</Link>
            <span><time dateTime={item.retractedAt}>{formatRomeDateTime(item.retractedAt)}</time>: {item.note}</span>
          </li>
        ))}
      </ul>
      <p>Per segnalare un errore: <Link href="/contatti">contatti</Link>.</p>
    </InfoPage>
  );
}
