# Stato di OgniOra 2.0

Aggiornato al 7 novembre 2026. "Verificato" significa eseguito davvero, non solo scritto.

## Criteri di accettazione MVP

| # | Criterio | Stato | Note |
| --- | --- | --- | --- |
| 1 | Raccoglie notizie da fonti reali | Verificato | 12 feed su GitHub Actions: 352 articoli scritti su Supabase |
| 2 | Raggruppa notizie dello stesso evento | Verificato | 35 eventi con più fonti. Può dividere una storia: i primi due candidati erano la stessa |
| 3 | Conserva fonti e timestamp | Verificato | Su Supabase reale |
| 4 | Produce script strutturati | Verificato | 3 script reali con Sonnet 5.5, campione ancora piccolo |
| 5 | Blocca le affermazioni non supportate | Verificato | Ha bloccato un numero assente dalle fonti. Tasso di falsi positivi da misurare |
| 6 | Audio italiano comprensibile | Da fare | Provider scritti, mai eseguiti: manca la chiave TTS |
| 7 | Video verticale con sottotitoli | Da fare | Render spec e sottotitoli pronti, template Remotion assente |
| 8 | Rendering su GitHub Actions | Da fare | Dipende dal 7 |
| 9 | Stati e risultati su Supabase | Parziale | Progetto attivo e migrazioni applicate. Mancano gli stati di produzione video |
| 10 | Revisione tramite dashboard | Da fare | RLS e RPC pronte, interfaccia assente |
| 11 | Upload di collaudo non pubblico | Da fare | Codice pronto e mai eseguito |
| 12 | Nessuna pubblicazione accidentale | Verificato | Policy e vincoli testati. Upload legacy forzati a privato |
| 13 | Errori e retry senza duplicazioni | Parziale | Idempotenza testata su database e per gli script. Upload mai eseguito |
| 14 | Consumi tracciati | Verificato | Token e costi reali su `provider_usage` |
| 15 | Nessun nuovo VPS | Verificato | Per progetto |

## Prove reali

Tre script generati il 7 novembre 2026 su Supabase reale, costo stimato totale 0,29 USD.

| Evento | Prompt | Bozze | Esito |
| --- | --- | --- | --- |
| Viaggio del Papa | Iniziale | 2 | `needs_review`, testo a elenco di dichiarazioni |
| Nomina Anac | Racconto | 2 | `blocked`: 1 blocco legittimo e 2 falsi positivi, poi corretti |
| Trump e Ucraina | Racconto | 2 | `needs_review`, testo discorsivo |

Tutti e tre hanno richiesto due bozze: ogni script costa quindi circa 0,10 USD. Su tre esempi
non si può stimare un tasso di successo.

## Prossimi passi

1. Rivedere i tre script e decidere se il tono è quello giusto.
2. Chiave TTS e decisione sul piano Azure.
3. Fase C: template Remotion e workflow di rendering.
4. Fase D: Studio in export statico e utente `admin`.
5. Fase E: primo upload privato di collaudo, poi analytics.
6. Benchmark tra modelli, anche per ridurre il costo a script.
