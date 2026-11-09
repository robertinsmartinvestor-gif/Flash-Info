import type { Metadata } from "next";
import Link from "next/link";
import { SITE_INFO } from "@/src/public/site-info";
import { InfoPage, OwnerFact } from "../components";

export const metadata: Metadata = { title: "Privacy", alternates: { canonical: "/privacy" } };

// States only what the code does: the public pages set no cookies and load no third-party scripts.
// The owner must review this text with the hosting contract before going live.
export default function PrivacyPage() {
  return (
    <InfoPage eyebrow="OGNIORA / PRIVACY" title="Informativa sulla privacy">
      <dl className="facts">
        <dt>Titolare del trattamento</dt><dd><OwnerFact info={SITE_INFO} field="privacyController" /></dd>
        <dt>Contatto</dt><dd><Link href="/contatti">Pagina contatti</Link></dd>
      </dl>
      <h2>Cosa raccogliamo</h2>
      <p>Le pagine pubbliche di OgniOra non usano cookie, non chiedono di registrarsi e non caricano script pubblicitari o di statistica di terze parti.</p>
      <p>Come ogni sito, il servizio che ospita le pagine registra dati tecnici delle richieste (per esempio indirizzo IP, data e pagina richiesta) per sicurezza e funzionamento. <OwnerFact info={SITE_INFO} field="hostingNotice" /></p>
      <h2>Link esterni</h2>
      <p>I collegamenti alle fonti e al canale YouTube portano a siti di terzi, con proprie informative.</p>
      <h2>Diritti</h2>
      <p>Puoi chiedere accesso, rettifica o cancellazione dei tuoi dati scrivendo ai contatti indicati. Hai diritto di presentare reclamo al Garante per la protezione dei dati personali.</p>
    </InfoPage>
  );
}
