import type { Metadata } from "next";
import { SITE_INFO } from "@/src/public/site-info";
import { InfoPage, OwnerFact } from "../components";

export const metadata: Metadata = { title: "Contatti", alternates: { canonical: "/contatti" } };

export default function ContactPage() {
  const email = SITE_INFO.contactEmail?.trim();
  return (
    <InfoPage eyebrow="OGNIORA / CONTATTI" title="Contatti">
      <p>Per segnalare un errore, chiedere una correzione o scrivere alla redazione:</p>
      <dl className="facts">
        <dt>Email della redazione</dt>
        <dd>{email ? <a href={`mailto:${email}`}>{email}</a> : <OwnerFact info={SITE_INFO} field="contactEmail" />}</dd>
        <dt>Editore</dt><dd><OwnerFact info={SITE_INFO} field="publisherName" /></dd>
      </dl>
      <p>Nella segnalazione indica l’indirizzo della scheda e, se puoi, una fonte che documenti l’errore. Le correzioni vengono pubblicate sulla scheda con data e motivo.</p>
    </InfoPage>
  );
}
