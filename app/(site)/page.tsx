import Link from "next/link";
import { groupByRomeDay, listPublished } from "@/src/public/digest";
import { YOUTUBE_URL } from "@/src/public/site-info";
import { StoryCard } from "./components";

export const revalidate = 60;

export default async function Home() {
  const { ok, data } = await listPublished(60);
  const days = groupByRomeDay(data);

  return (
    <>
      <section className="public-hero" aria-labelledby="hero-title">
        <div className="public-hero-inner">
          <p className="public-eyebrow"><span className="live-dot" aria-hidden="true" /> IL PUNTO SULLE NOTIZIE</p>
          <h1 id="hero-title">Le notizie, <em>con le fonti.</em></h1>
          <p className="public-lead">Un riepilogo essenziale dei fatti selezionati dalla redazione. Ogni scheda rimanda agli articoli originali, così puoi controllare da dove arriva la notizia.</p>
          <div className="hero-actions">
            <a className="public-primary" href="#notizie">Leggi il riepilogo <span aria-hidden="true">↓</span></a>
            <Link className="public-secondary" href="/metodo">Come verifichiamo</Link>
          </div>
        </div>
        <div className="hero-mark" aria-hidden="true">O<span>.</span></div>
      </section>
      <section className="public-news" id="notizie" aria-labelledby="news-title">
        <div className="section-intro">
          <div><p className="public-eyebrow">OGNIORA / AGGIORNAMENTI</p><h2 id="news-title">Il riepilogo</h2></div>
          <p>Le schede compaiono dopo la verifica di una persona della redazione su almeno due fonti indipendenti.</p>
        </div>
        {!ok && <p className="public-empty" role="status">Il riepilogo non è disponibile in questo momento. Riprova tra qualche minuto.</p>}
        {ok && days.length === 0 && (
          <div className="public-empty">
            <strong>Il primo riepilogo è in preparazione.</strong>
            <p>Intanto trovi gli ultimi aggiornamenti sul canale video.</p>
            <a href={YOUTUBE_URL} target="_blank" rel="noopener noreferrer">Vai a OgniOra su YouTube<span aria-hidden="true"> ↗</span></a>
          </div>
        )}
        {days.map((day) => (
          <section className="digest-day" key={day.key} aria-labelledby={`giorno-${day.key}`}>
            <h3 className="day-label" id={`giorno-${day.key}`}>
              <span>{day.label}</span>
              <span>{day.items.length} {day.items.length === 1 ? "notizia" : "notizie"}</span>
            </h3>
            <div className="story-grid">
              {day.items.map((item, index) => <StoryCard key={item.id} item={item} index={index} />)}
            </div>
          </section>
        ))}
      </section>
    </>
  );
}
