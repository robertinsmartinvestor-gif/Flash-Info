import type { Metadata } from "next";
import Link from "next/link";
import { SITE_INFO } from "@/src/public/site-info";
import { InfoPage, OwnerFact } from "../components";

export const metadata: Metadata = { title: "Chi siamo", alternates: { canonical: "/chi-siamo" } };

export default function AboutPage() {
  return (
    <InfoPage eyebrow="OGNIORA / CHI SIAMO" title="Chi pubblica OgniOra">
      <p>OgniOra pubblica riepiloghi brevi delle notizie del giorno e video verticali sul canale YouTube. Ogni scheda del sito rimanda agli articoli originali da cui è tratta.</p>
      <dl className="facts">
        <dt>Editore</dt><dd><OwnerFact info={SITE_INFO} field="publisherName" /></dd>
        <dt>Sede</dt><dd><OwnerFact info={SITE_INFO} field="publisherAddress" /></dd>
        <dt>Partita IVA o codice fiscale</dt><dd><OwnerFact info={SITE_INFO} field="publisherTaxId" /></dd>
        <dt>Responsabile dei contenuti</dt><dd><OwnerFact info={SITE_INFO} field="editorInCharge" /></dd>
        <dt>Registrazione</dt><dd><OwnerFact info={SITE_INFO} field="registration" /></dd>
        <dt>Contatti</dt><dd><Link href="/contatti">Pagina contatti</Link></dd>
      </dl>
      <h2>Strumenti automatici</h2>
      <p>La raccolta degli articoli dai feed delle testate e la preparazione dei testi dei video usano strumenti automatici, inclusi modelli di intelligenza artificiale. Le schede del sito sono scritte e pubblicate da una persona della redazione, che controlla le fonti prima della pubblicazione. Il metodo è descritto nella pagina <Link href="/metodo">Metodo di verifica</Link>.</p>
      <h2>Indipendenza</h2>
      <p>OgniOra non è affiliata alle testate citate come fonti. I collegamenti alle fonti servono a permettere a chi legge di controllare la notizia, non indicano un accordo con le testate.</p>
    </InfoPage>
  );
}
