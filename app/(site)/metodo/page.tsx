import type { Metadata } from "next";
import Link from "next/link";
import { InfoPage } from "../components";

export const metadata: Metadata = { title: "Metodo di verifica", alternates: { canonical: "/metodo" } };

// Describes the rules enforced in code and in the database (publish_digest_item); keep the two in sync.
export default function MethodPage() {
  return (
    <InfoPage eyebrow="OGNIORA / METODO" title="Come scegliamo e verifichiamo le notizie">
      <h2>1. Raccolta</h2>
      <p>Raccogliamo i titoli e le brevi descrizioni pubblicate nei feed RSS di un elenco di testate. Scartiamo gli articoli senza data, quelli più vecchi di tre giorni e i doppioni. Gli articoli che parlano dello stesso fatto vengono raggruppati in un evento.</p>
      <h2>2. Almeno due fonti indipendenti</h2>
      <p>Un evento può diventare una scheda del sito solo se ne parlano almeno due fonti indipendenti tra loro, cioè non appartenenti allo stesso gruppo editoriale, con un indirizzo sicuro (https). Gli eventi riportati da una sola fonte e le notizie di scarso valore informativo (estrazioni del lotto, oroscopi, previsioni meteo, gallerie fotografiche, offerte commerciali) non vengono pubblicati.</p>
      <h2>3. Verifica di una persona</h2>
      <p>Una persona della redazione con ruolo di amministratore apre gli articoli originali, scrive un titolo e una sintesi con parole proprie e conferma di aver verificato ogni affermazione. Il sistema rifiuta i testi che riprendono frasi intere dei titoli o delle descrizioni delle fonti. Non pubblichiamo testi o immagini delle testate.</p>
      <h2>4. Fonti sempre visibili</h2>
      <p>I collegamenti alle fonti sono scelti dal sistema tra gli articoli dell’evento, uno per gruppo editoriale, e non possono essere modificati a mano. Ogni scheda li mostra sotto la sintesi.</p>
      <h2>5. Video e controlli automatici</h2>
      <p>I testi dei video passano controlli automatici sulle fonti e sul tono. Un testo bloccato o trattenuto da quei controlli non arriva mai sul sito: un evento che ha già un testo video non può diventare una scheda.</p>
      <h2>6. Correzioni e ritiri</h2>
      <p>Se una scheda contiene un errore la correggiamo e indichiamo data e motivo della correzione. Se una notizia si rivela infondata la ritiriamo: l’indirizzo resta attivo con la data e il motivo del ritiro. Le regole sono nella pagina <Link href="/correzioni">Correzioni</Link>.</p>
      <h2>Date e orari</h2>
      <p>Le date indicate sono quelle di pubblicazione e di aggiornamento della scheda su OgniOra, nel fuso orario di Roma. La data dei fatti è quella riportata dalle fonti.</p>
    </InfoPage>
  );
}
