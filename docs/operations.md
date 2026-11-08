# Operazioni

## Workflow GitHub Actions

| Workflow | Avvio | Cosa fa |
| --- | --- | --- |
| `ci.yml` | PR e push su `main` | Typecheck, lint, test, build, audit, gitleaks |
| `editorial.yml` | n8n o manuale | Raccolta notizie, generazione script |
| `autopilot.yml` | n8n ogni ora 6-22, GitHub ogni 3 ore come riserva | Tutta la catena fino all'upload pubblico: vedi "Pilota automatico" |
| `production.yml` | Manuale | Audio e video dei job in coda |
| `distribution.yml` | Manuale | Upload di una voce approvata |
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
| Pilota automatico | Ogni ora, 6-22 (Europe/Rome) | Avvia `autopilot.yml`. Usa solo la credenziale `OgniOra GitHub` |
| 3 - Controllo | Ogni giorno | Manutenzione e notifica riepilogativa |

Credenziali da creare in n8n:

| Nome | Tipo | Contenuto |
| --- | --- | --- |
| `OgniOra GitHub` | Header Auth | `Authorization: Bearer <token>`. Token fine-grained, solo questo repository, permesso *Actions: read and write* |
| `OgniOra Supabase` | Custom Auth | `{"headers": {"apikey": "<chiave>", "Authorization": "Bearer <chiave>"}}` |

Il workflow 3 è l'unico che legge Supabase, con la service role, che dà pieno accesso ai dati: l'istanza n8n
è condivisa con Lepefy, quindi prima di attivarlo va valutato un ruolo di sola lettura dedicato.

Variabili d'ambiente: `OGNIORA_SUPABASE_URL`, `OGNIORA_NOTIFY_WEBHOOK`.


## Studio

`/studio` ha quattro pagine:

- **Panoramica:** interruttore del pilota, spesa del mese sul tetto, numeri della pipeline, ultimi video e attività.
- **Revisione:** script da rivedere, approvati e bloccati, con i passi audio → video → YouTube.
- **Pubblicazioni:** ogni voce della coda YouTube, con stato e visibilità.
- **Impostazioni:** regole del pilota, spesa, produzione, conservazione e voce. Solo gli admin modificano.

Le impostazioni sono descritte nella tabella `setting_fields` (tipo, limiti, etichetta, sezione) e si
salvano con `update_setting`, che controlla ogni valore e registra la modifica in `audit_logs`. Per
aggiungerne una basta una migrazione che inserisce la riga in `setting_fields` e il valore iniziale in
`app_settings`: la pagina la mostra senza altro codice.

Il tetto di spesa mensile è `app_settings.budget.monthly_usd`, letto dai job a ogni avvio. La variabile
`AI_MONTHLY_BUDGET_USD` resta solo come riserva se il valore manca.

## Pilota automatico

`autopilot.yml` parte ogni ora dalle 6 alle 22 da n8n (workflow *OgniOra - Pilota automatico*),
che è puntuale. Il cron di GitHub, spesso in ritardo, resta solo come riserva ogni 3 ore. In ogni giro:

1. raccoglie le notizie;
2. sceglie al massimo un candidato Flash fresco, con il punteggio più alto, e scrive lo script;
3. lo approva se il QC lo permette;
4. mette in coda audio, video e pubblicazione degli script approvati nelle ultime 24 ore,
   anche quelli approvati a mano nello Studio;
5. carica su YouTube come **pubblico** le voci autorizzate.

Le regole stanno in `app_settings.autopilot` e si cambiano da **Studio → Impostazioni**, senza deploy:

| Campo | Valore iniziale | Effetto |
| --- | --- | --- |
| `enabled` | `true` | `false` ferma ogni passo |
| `max_stories_per_day` | 3 | Nuove notizie scritte in 24 ore |
| `min_gap_hours` | 3 | Distanza minima tra due notizie |
| `publish_hours` | 07, 12, 18 | Ore (italiane) in cui il pilota sceglie una nuova notizia |
| `max_age_hours` | 24 | Oltre, uno script non viene più prodotto né pubblicato |
| `candidate_max_age_hours` | 8 | Età massima di un candidato |
| `hold_checks` | verifier, verifier_unavailable, verifier_incomplete, sensitive_topic, sensational_language | Rilievi che fermano l'approvazione automatica |

Ogni script ha fino a tre bozze: la seconda corregge blocchi e affermazioni sostenute in parte, la terza
solo le affermazioni sostenute in parte. Uno script bloccato o con uno dei rilievi in `hold_checks` resta nello Studio: se lo approvi a
mano, il pilota lo produce e lo pubblica nel giro successivo. Ogni decisione automatica è in
`audit_logs` con `actor_type = system`: `candidate.auto_selected`, `script.auto_approved`,
`script.auto_held`, `publication.public_authorized` con `{"by": "autopilot"}`.

Per fermare tutto: *Actions → Autopilot → Disable workflow*, oppure

```sql
update app_settings set value = jsonb_set(value, '{enabled}', 'false') where key = 'autopilot';
```

Per togliere un video già pubblicato: YouTube Studio.

Costi: con 3 notizie al giorno circa 0,12 USD l'una (script e voce), quindi circa 11 USD al mese,
sotto il tetto di spesa impostato nello Studio. La copertina non costa nulla: è disegnata dal template.
Per la quota della YouTube Data API vedi [Copertine](#copertine).

## Pubblicazione

Stati di `publication_queue`: `pending`, `scheduled`, `uploading`, `processing`, `finalizing`,
`uploaded`, `failed`, `cancelled`. Ogni passaggio finisce in `audit_logs`.

Perché un video diventi pubblico devono essere vere **tutte** queste condizioni:

1. Script approvato, con QC non bloccato.
2. Autorizzazione di un utente `admin`, registrata in `publication_queue`.
3. `ALLOW_PUBLIC_PUBLICATION=true` e `OGNIORA_ENV=production`, impostati **in chiaro** in
   `autopilot.yml` e `distribution.yml`: cambiarli richiede una modifica revisionata.

L'autorizzazione al punto 2 può venire anche dal pilota automatico
(`public_authorized_policy = autopilot`).

Un video privato con `publishAt` diventa pubblico da solo: per questo la data viene inviata a
YouTube solo se il pubblico è autorizzato. Senza, il video resta privato.

### Upload rimasti in `uploading`

Dopo un crash una voce resta in `uploading` e **non** viene ritentata: il video potrebbe già
esistere. Il log del job riporta `upload_not_registered:<id YouTube>` quando il video è stato caricato
ma l'id non è stato salvato. Controlla YouTube Studio, poi:

- voce **con copertina** (`thumbnail_asset_id` valorizzato) e video presente: registra l'id con
  `select record_youtube_video('<queue_id>', '<id YouTube>')` (ruolo service). La voce passa in
  `processing` e il giro successivo del pilota, o **Distribution** con lo stesso `queue_id`, mette la
  copertina e applica la visibilità. Il video non viene caricato di nuovo;
- voce **senza copertina** e video presente: `register_youtube_upload` come prima;
- video assente: riporta la voce in `failed`, il giro successivo la ricarica.

`maintenance.yml` riporta quante voci sono in `uploading`.

## Copertine

Ogni nuovo Short ha una copertina 1080×1920 PNG, legata alla stessa versione approvata da cui
derivano audio e video.

**Testo.** Lo script contiene un blocco `cover`, scritto dal modello insieme alle frasi:

- `headline`: da 3 a 7 parole, al massimo 40 caratteri;
- `qualifier`: vuoto oppure uno tra `PER ORA`, `IN ATTESA`, `NON CONFERMATO`, `SECONDO LE FONTI`;
- `subline`: al massimo 50 caratteri, facoltativa;
- `visual`: tema dell'illustrazione;
- `evidence`: citazioni testuali delle fonti.

La copertina passa gli stessi controlli di una frase di fatto: fonte citata, citazione testuale,
nessun numero o nome assente dalle fonti. In più ha controlli propri su lunghezza e tono (niente
`!`, `?` o parole sensazionalistiche). Il verificatore semantico la valuta come un'affermazione in
più: un esito `partial` fa riscrivere lo script come per le frasi. Ogni problema della copertina
blocca lo script. Le versioni salvate prima delle copertine non hanno il blocco: la copertina usa il
loro titolo, già controllato, e nessun'altra affermazione (`rights.text = approved_script_title`).

**Grafica.** Template Remotion `cover-v1` (`video/src/CoverV1.tsx`):

- testo e marchio composti dal codice;
- illustrazione vettoriale originale per tema (`video/src/Illustrations.tsx`), di proprietà del
  progetto, senza foto né scritte;
- colori e composizione che variano per versione.

Il testo resta fuori dal 20% inferiore e dal margine destro dei comandi di YouTube. Il titolo si
rimpicciolisce finché entra; se non entra nemmeno alla dimensione minima, il render fallisce con
`render_cover_text_overflow`. Una copertina con testo tagliato non esce mai.

**Pipeline.** Il job video rende prima la copertina, poi il video. Controlla dimensioni e peso del
PNG (massimo 2 MB) e salva tutto nel bucket privato `media`:

- percorso `thumbnail/<script_version_id>/cover-v1.png`;
- `media_assets.kind = 'thumbnail'`, con hash e provenienza in `rights`.

Una versione entra in coda solo con video **e** copertina: `queue_publication` e il pilota lo
verificano. Se la copertina manca, il pilota conta la versione come "senza copertina, in attesa" e non
la mette in coda.

**Upload in due tempi.**

1. `uploading`: `videos.insert` sempre **privato**, senza `publishAt`. L'id restituito viene salvato
   subito (`record_youtube_video`) e da lì la voce non può più essere caricata di nuovo.
2. `processing` / `finalizing`. In un giro:
   - attesa con tentativi limitati che `videos.list` riporti `processingStatus = succeeded`
     (12 controlli ogni 15 s, poi riprova al giro dopo);
   - `thumbnails.set` con il PNG;
   - conferma della copertina solo se l'API risponde con la nuova miniatura;
   - visibilità finale calcolata di nuovo da `decideUpload()`, con `videos.update`.
3. `uploaded`: copertina confermata e visibilità applicata. Il log dice "Copertina confermata da
   YouTube" solo a questo punto.

Un `publishAt` futuro diventa privato + `publishAt`; uno già passato diventa pubblico subito, mai prima
del dovuto. Se nel frattempo l'autorizzazione è venuta meno, il video resta privato.

Errori della copertina: `thumbnail_status = failed`, `thumbnail_attempts` e `thumbnail_error`, separati
da `last_error`. Il video resta privato e il pilota ritenta a ogni giro, fino a 5 tentativi, ripartendo
dall'id YouTube salvato. Dopo 5 tentativi serve una persona:

1. guarda `thumbnail_error`;
2. carica la copertina a mano da YouTube Studio, se serve;
3. azzera `thumbnail_attempts` per ritentare.

Un runner interrotto in `finalizing` libera la voce dopo 30 minuti.

**Permessi.** `thumbnails.set` accetta lo scope `youtube.upload`, ma `videos.update` e i dettagli di
elaborazione di `videos.list` richiedono `youtube` o `youtube.force-ssl`. Il job lo controlla
**prima** di caricare: senza scope la voce va in `failed` con `youtube_scope_missing` e nessun video
viene caricato. Il workflow **Test Token** stampa gli scope del refresh token (sono nomi di
permessi, non segreti) e avvisa se manca quello necessario. In quel caso il refresh token va
rigenerato includendo `https://www.googleapis.com/auth/youtube.force-ssl` (e, già che ci sei,
`yt-analytics.readonly`).

Un video reso pubblico dopo il caricamento non invia la notifica agli iscritti: YouTube la legge solo
in `videos.insert`.

**Quota YouTube Data API** (10.000 unità al giorno di default), per ogni Short:

| Chiamata | Costo | Note |
| --- | --- | --- |
| `videos.insert` | vedi nota | La pagina di riferimento oggi indica un contingente "Video Uploads" separato (100 upload al giorno); in passato erano 1.600 unità. Verifica in Google Cloud Console |
| `videos.list` | 1 unità per controllo | Al massimo 12 per giro |
| `thumbnails.set` | circa 50 | Per tentativo |
| `videos.update` | 50 | Solo se la visibilità finale non è "privato" |

Con 3 Short al giorno la copertina aggiunge circa 300–350 unità.

**Rollback.**

1. Revert del merge: il codice torna all'upload in un passo. Le colonne nuove sono facoltative e le
   voci vecchie non le usano.
2. Le voci già in `processing` vanno completate a mano in YouTube Studio:
   - copertina e visibilità;
   - poi `update publication_queue set status = 'uploaded'` e la privacy giusta in
     `youtube_publications`.
3. La migrazione può restare: è solo in avanti, ma `queue_item` richiede la copertina. Se il codice
   torna indietro, riapplica la versione precedente di `private.queue_item` da
   `20261108000200_autopilot.sql`, altrimenti nessuna voce nuova entra in coda.

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
Nello stesso job disegna la copertina della versione (vedi [Copertine](#copertine)).

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
2. Copia il `queue_id` mostrato e avvia a mano il workflow **Distribution** con quel valore.
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
