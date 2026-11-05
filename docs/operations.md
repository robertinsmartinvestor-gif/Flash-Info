# Operazioni

## Workflow GitHub Actions

| Workflow | Avvio | Cosa fa |
| --- | --- | --- |
| `ci.yml` | PR e push su `main` | Typecheck, lint, test, build, audit, gitleaks |
| `editorial.yml` | n8n o manuale | Raccolta notizie, generazione script |
| `distribution.yml` | Manuale | Upload di una voce approvata |
| `maintenance.yml` | n8n o manuale | Job bloccati, asset scaduti, retention, spesa |
| `cron.yml` | Solo manuale | Pipeline legacy |

Non c'è ancora un workflow di rendering: il template Remotion è il prossimo lavoro della Fase C.

Il repository è pubblico: chiunque può leggere log e scaricare artifact. I job non stampano
contenuti né segreti, e le anteprime vanno su Supabase Storage, mai negli artifact.

## n8n

I file in `n8n/` si importano da *Workflows → Import from File*. Sono tutti **disattivati**:
attivali uno alla volta dopo il collaudo. Non toccano i workflow degli altri progetti, ma
controlla che i nomi delle credenziali non siano già in uso.

| Workflow | Frequenza | Funzione |
| --- | --- | --- |
| 1 - Raccolta notizie | 2 ore | Avvia `editorial.yml` con `ingest` |
| 2 - Script | 10 minuti | Avvia `compose` per i candidati scelti, massimo 3 per giro |
| 3 - Controllo | Ogni giorno | Manutenzione e notifica riepilogativa |

Credenziali da creare in n8n:

| Nome | Tipo | Contenuto |
| --- | --- | --- |
| `OgniOra GitHub` | Header Auth | `Authorization: Bearer <token>`. Token fine-grained, solo questo repository, permesso *Actions: read and write* |
| `OgniOra Supabase` | Custom Auth | `{"headers": {"apikey": "<chiave>", "Authorization": "Bearer <chiave>"}}` |

La chiave Supabase è la service role: dà pieno accesso ai dati. Se l'istanza n8n è condivisa con
altri progetti o persone, va valutato un ruolo di sola lettura dedicato prima di attivare i workflow.

Variabili d'ambiente: `OGNIORA_SUPABASE_URL`, `OGNIORA_NOTIFY_WEBHOOK`.

Il workflow 2 legge una volta ogni 10 minuti: con il progetto Supabase attivo, questo tiene
lontana anche la pausa per inattività del piano free.

## Pubblicazione

Stati di `publication_queue`: `pending`, `scheduled`, `uploading`, `uploaded`, `failed`,
`cancelled`. Ogni passaggio finisce in `audit_logs`.

Perché un video diventi pubblico devono essere vere **tutte** queste condizioni:

1. Script approvato, con QC non bloccato.
2. Autorizzazione di un utente `admin`, registrata in `publication_queue`.
3. `ALLOW_PUBLIC_PUBLICATION=true` e `OGNIORA_ENV=production`, impostati **in chiaro** in
   `distribution.yml`: serve una modifica revisionata al file.

Oggi il workflow fissa `false` e `staging`, quindi il pubblico è impossibile.

Un video privato con `publishAt` diventa pubblico da solo: per questo la data viene inviata a
YouTube solo se il pubblico è autorizzato. Senza, il video resta privato.

### Upload rimasti in `uploading`

Dopo un crash una voce resta in `uploading` e **non** viene ritentata: il video potrebbe già
esistere. Controlla YouTube Studio, poi registra il video con `register_youtube_upload` oppure
riporta la voce in `failed`. `maintenance.yml` riporta quante voci sono in questo stato.

## Script bloccati in `composing`

Se un job `compose` fallisce, il candidato resta in `composing` e non viene ritentato, così la
spesa non si ripete a ogni giro di n8n. Riportalo a `selected` dopo aver capito la causa.

## Rotazione dei segreti

1. Crea il nuovo segreto presso il provider.
2. Aggiorna GitHub Secrets (e Vercel per il legacy).
3. Esegui il workflow *Test Token* per YouTube.
4. Revoca il vecchio.

Per Analytics il refresh token deve includere `yt-analytics.readonly`: va rigenerato.
