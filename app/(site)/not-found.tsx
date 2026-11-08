import Link from "next/link";

export default function NotFound() {
  return (
    <article className="info-page">
      <p className="public-eyebrow">ERRORE 404</p>
      <h1>Pagina non trovata</h1>
      <p>La scheda che cerchi non esiste o l’indirizzo non è corretto. <Link href="/">Torna al riepilogo</Link>.</p>
    </article>
  );
}
