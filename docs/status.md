# Stato di OgniOra 2.0

Aggiornato al 5 novembre 2026. "Verificato" significa eseguito davvero, non solo scritto.

## Criteri di accettazione MVP

| # | Criterio | Stato | Note |
| --- | --- | --- | --- |
| 1 | Raccoglie notizie da fonti reali | Verificato | 12 feed, 363 articoli, in dry-run |
| 2 | Raggruppa notizie dello stesso evento | Verificato | 41 eventi con più fonti su dati reali |
| 3 | Conserva fonti e timestamp | Verificato | Store testato su PostgREST reale |
| 4 | Produce script strutturati | Parziale | Codice testato con modello simulato. Mai eseguito con un modello reale |
| 5 | Blocca le affermazioni non supportate | Parziale | QC testato. Da misurare su output reali |
| 6 | Audio italiano comprensibile | Da fare | Provider scritti, mai eseguiti: mancano le chiavi |
| 7 | Video verticale con sottotitoli | Da fare | Render spec e sottotitoli pronti, template Remotion assente |
| 8 | Rendering su GitHub Actions | Da fare | Dipende dal 7 |
| 9 | Stati e risultati su Supabase | Parziale | Schema verificato su Postgres Supabase. Progetto non creato |
| 10 | Revisione tramite dashboard | Da fare | RLS e RPC pronte, interfaccia assente |
| 11 | Upload di collaudo non pubblico | Da fare | Codice pronto e mai eseguito |
| 12 | Nessuna pubblicazione accidentale | Verificato | Policy e vincoli testati. Upload legacy forzati a privato |
| 13 | Errori e retry senza duplicazioni | Verificato | Idempotenza testata su database |
| 14 | Consumi tracciati | Verificato | Token, costi stimati e blocco del budget |
| 15 | Nessun nuovo VPS | Verificato | Per progetto |

## Prossimi passi

1. Azioni del proprietario: `docs/audit-2026.md`, sezione finale.
2. Primo script reale con chiave IA e budget basso, poi benchmark.
3. Fase C: template Remotion e workflow di rendering.
4. Fase D: Studio in export statico.
5. Fase E: primo upload privato di collaudo, poi analytics.
