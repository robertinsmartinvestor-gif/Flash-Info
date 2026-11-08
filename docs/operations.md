# Operazioni

## Workflow GitHub Actions

| Workflow | Avvio | Cosa fa |
| --- | --- | --- |
| `ci.yml` | PR e push su `main` | Typecheck, lint, test, build, audit, gitleaks |
| `editorial.yml` | n8n o manuale | Raccolta notizie, generazione script |
| `production.yml` | n8n o manuale | Audio e video dei job messi in coda dallo Studio |
| `distribution.yml` | n8n o manuale | Upload privato di una voce approvata |
| `maintenance.yml` | n8n o manuale | Job bloccati, asset scaduti, retention, spesa |
| `cron.yml` | Solo manuale | Pipeline legacy |

Il rendering gira nel workflow Production: vedi "Produzione video".

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
| 4 - Produzione e upload | 10 minuti | Avvia `production.yml` se ci sono job audio o video in coda; avvia `distribution.yml` per una voce `pending` e privata alla volta |

Credenziali da creare in n8n:

| Nome | Tipo | Contenuto |
| --- | --- | --- |
| `OgniOra GitHub` | Header Auth | `Authorization: Bearer <token>`. Token fine-grained, solo questo repository, permesso *Actions: read and write* |
| `OgniOra Supabase` | Custom Auth | `{"headers": {"apikey": "<chiave>", "Authorization": "Bearer <chiave>"}}` |

La chiave Supabase è la service role: dà pieno accesso ai dati. Se l'istanza n8n è condivisa con
altri progetti o persone, va valutato un ruolo di sola lettura dedicato prima di attivare i workflow.

Variabili d'ambiente: `OGNIORA_SUPABASE_URL`, `OGNIORA_NOTIFY_WEBHOOK`.

Il workflow 4 non decide nulla: audio, video e upload partono solo da un clic nello Studio su uno
script approvato. Riprende solo voci `pending`: un upload `failed` o rimasto in `uploading` resta
fermo finché non lo controlli. Il canale riceve sempre un video privato, perché `distribution.yml`
fissa `ALLOW_PUBLIC_PUBLICATION=false`. Un avvio doppio non carica due volte: `begin_upload` e
`claim_job` assegnano ogni voce una sola volta.

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

## Revisione script

In `/studio/revisione` lo staff vede l'ultima versione di ogni script, con frasi, fonti citate e avvisi del
QC. Approvare non pubblica nulla. Gli script bloccati non si possono approvare, e un'approvazione si può
ritirare respingendo lo script. La nota è obbligatoria per respingere. Ogni decisione finisce in `audit_logs`.

Ogni video con voce sintetica dichiara "voce generata con IA": i termini Google vietano di presentare
i contenuti generati come creati da una persona, al fine di ingannare.

## Produzione audio

1. In `/studio/revisione` apri uno script approvato e premi **Genera audio**: crea un job in coda.
2. Avvia a mano il workflow **Production** su GitHub Actions. Elabora al massimo tre job per run.
3. Ricarica la pagina: il lettore audio compare nello script.

Il job legge la voce da `tts_voice`, salva il file nel bucket privato `media`, lo registra in
`media_assets` e il consumo in `provider_usage`, a prezzo di listino. Si ferma prima di spendere se la
versione non è quella approvata, se la voce non è in catalogo, se mancano le credenziali o se il
budget mensile è esaurito. Per ogni versione esiste un solo job audio: cambiare voce dopo non genera
un nuovo file. Un job fallito non viene ritentato. Gli audio scadono secondo `retention_days.media_preview`.

## Produzione video

1. In `/studio/revisione`, quando l'audio di uno script approvato è pronto, premi **Genera video**.
2. Avvia a mano il workflow **Production** con `mode: produce`. Elabora prima l'audio, poi i video.
3. Ricarica la pagina: il lettore video compare nello script.

Il job scarica l'audio, ne misura la durata, costruisce la render spec e rende il template
`flash-v1` con Remotion. Salva nel bucket privato il video e i sottotitoli SRT, con la retention
`retention_days.media_preview`. Niente immagini giornalistiche: solo testo e sfondo generato.

I sottotitoli distribuiscono il tempo in base ai caratteri, perché Google non restituisce i tempi
delle parole: **controlla la sincronia** quando guardi il video. Se l'audio è scaduto il job fallisce
con `render_audio_missing`. Per ogni versione esiste un solo job video.

`mode: sample` rende un testo inventato su audio muto: non legge dati né segreti e serve a provare
il template. Il suo artifact è pubblico, quindi non deve mai contenere uno script reale.

## Upload privato su YouTube

1. In `/studio/revisione`, quando il video di uno script approvato è pronto, premi
   **Metti in coda per YouTube (privato)**. La voce in coda è sempre privata, con
   `containsSyntheticMedia` attivo; titolo, descrizione e tag vengono dai metadati salvati con la
   versione, costruiti dalle fonti citate.
2. Con il workflow n8n 4 attivo l'upload parte entro 10 minuti. Altrimenti copia il `queue_id`
   mostrato e avvia a mano il workflow **Distribution** con quel valore.
3. Ricarica la pagina: compare il link a YouTube Studio.

Prima di un upload controlla con il workflow **Test Token** che le credenziali YouTube funzionino.
Il canale è quello del refresh token salvato nei segreti.

## Voce TTS

La voce sta in `app_settings`, chiave `tts_voice`. Un admin la cambia da `/studio/voce` e ogni modifica
finisce in `audit_logs`. Il valore iniziale è Google Chirp 3 HD Charon, scelto con il test d'ascolto del
7 novembre 2026. Il job di produzione audio la legge con `findVoice()` e si ferma se restituisce `null`.

Per aggiungere una voce servono una riga in `VOICE_CATALOG` e una migrazione che aggiorni
`set_tts_voice`. Le voci Azure sono in catalogo ma non sono mai state provate con una chiave reale.

## Test d'ascolto TTS

Confronta alla cieca quattro voci: due Google Chirp 3 HD e due Azure HD. Ogni voce legge l'ultimo
script `needs_review` e una frase di prova su nomi, sigle e numeri.

1. Su Google Cloud abilita Cloud Text-to-Speech e la fatturazione, imposta un avviso di budget e
   crea un service account con una chiave JSON. Salvala nel segreto `GOOGLE_TTS_CREDENTIALS_JSON`.
2. Su Azure crea una risorsa Speech S0 in West Europe. Salva la chiave in `AZURE_TTS_KEY`. La
   variabile `AZURE_TTS_REGION` serve solo per un'altra regione.
3. Avvia il workflow manuale **Listening Test**. Basta anche un solo provider: l'altro viene saltato.
4. Ascolta i file in Supabase, *Storage → media → listening-test*, cartella del run. I nomi sono
   `A-script.mp3`, `A-pronuncia.mp3` e così via.
5. Vota prima di aprire il log del run: la chiave che collega lettere e voci è nell'ultima parte.

Il costo per run è di pochi centesimi ed è registrato in `provider_usage` a prezzo di listino, anche
quando rientra nella quota gratuita. I file non sono in `media_assets`: la retention non li
elimina, quindi vanno cancellati a mano dopo la scelta. Gli script non sono approvati: questi audio
restano privati e non vanno pubblicati.
