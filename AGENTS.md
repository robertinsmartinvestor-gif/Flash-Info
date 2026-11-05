# Istruzioni per agenti e sviluppatori

OgniOra è una piattaforma editoriale: un errore qui diventa un'informazione falsa
pubblicata. Accuratezza e sicurezza vengono prima di velocità e metriche.

## Regole non negoziabili

- Non modificare `main` direttamente: branch dedicato e pull request.
- Non pubblicare video pubblici durante sviluppo e collaudo.
- `PUBLICATION_MODE` resta `manual`. Non attivare `automatic`.
- Il privacy status inviato a YouTube viene solo da `decideUpload()`. L'API, se il
  campo manca, pubblica in pubblico: non ometterlo mai.
- L'IA non genera fatti: lavora solo sulle evidenze fornite e cita fonti esistenti.
  Non rilassare i controlli QC per far passare un contenuto.
- Il repository è pubblico, quindi lo sono log e artifact di GitHub Actions: niente
  segreti, token o bozze non approvate. Le anteprime vanno su Supabase Storage.
- Non riattivare la schedulazione di `cron.yml`: la pianificazione è in n8n.
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
