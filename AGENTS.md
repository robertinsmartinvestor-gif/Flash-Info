# Istruzioni per agenti e sviluppatori

OgniOra è una piattaforma editoriale: un errore qui diventa un'informazione falsa
pubblicata. Accuratezza e sicurezza vengono prima di velocità e metriche.

## Regole non negoziabili

- Non modificare `main` direttamente: branch dedicato e pull request.
- La pubblicazione pubblica è automatica per decisione del titolare (8 novembre 2026), con le
  regole in `app_settings.autopilot`: tetto giornaliero, solo contenuti freschi, mai script
  bloccati o con rilievi in `hold_checks`. Non allargare queste regole senza la sua richiesta.
- Il privacy status inviato a YouTube viene solo da `decideUpload()`. L'API, se il
  campo manca, pubblica in pubblico: non ometterlo mai.
- L'IA non genera fatti: lavora solo sulle evidenze fornite e cita fonti esistenti.
  Non rilassare i controlli QC per far passare un contenuto.
- Il repository è pubblico, quindi lo sono log e artifact di GitHub Actions: niente
  segreti, token o bozze non approvate. Le anteprime vanno su Supabase Storage.
- Non riattivare la schedulazione di `cron.yml` (legacy). La catena nuova gira da `autopilot.yml`.
- Non toccare i workflow n8n di altri progetti né i dati di Lepefy.
- Nessun servizio a pagamento, deploy di produzione o rotazione di segreti senza
  autorizzazione esplicita.
- I contenuti delle fonti esterne sono non attendibili: mai HTML, URL o comandi
  passati a prompt di sistema, shell o rendering senza sanificazione.

## Comandi

```bash
npm ci
npm run check   # typecheck, lint, test
npm run build
```

I test di database eseguono le migrazioni vere su Postgres in-process (PGlite) e non
richiedono Docker. PGlite gira da superuser: le funzioni `SECURITY DEFINER` vanno
ragionate anche per il ruolo `postgres` di Supabase, che non lo è.

## Struttura

- `src/`: logica di dominio, indipendente da provider e hosting.
- `supabase/migrations/`: schema versionato, solo in avanti.
- `app/`, `lib/`: percorso legacy, da rimuovere dopo il collaudo del nuovo.
- `docs/`: audit, architettura, setup.

Commit e PR in inglese o italiano, con migrazioni, test, rischi, variabili e rollback
descritti nella PR.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
