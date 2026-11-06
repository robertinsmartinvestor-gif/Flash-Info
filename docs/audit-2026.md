# Audit OgniOra (Flash-Info), 5 novembre 2026

Basato su `main` al commit `c758522`: lettura di tutti i 20 file (844 righe), cronologia
completa (45 commit), run di GitHub Actions, `npm audit` e prove a costo zero sul sito live.

## Sintesi

Il sistema è un prototipo fermo dal 25 giugno 2026. Pubblicava video in pubblico con testo
generato dall'IA, senza fonti né revisione. Gli endpoint che generano costi sono aperti su
Internet. Non esiste un database. Nessun segreto risulta nel codice o nella cronologia, ma
un workflow ha esposto un token nei log pubblici.

## Architettura reale

```
GitHub Actions (cron.yml)
  generate.mjs ─ POST non autenticato ─► Vercel /api/script    ─► Claude con web search
               ─ POST non autenticato ─► Vercel /api/voiceover ─► Azure / ElevenLabs
  ffmpeg: immagine fissa + audio
  upload-youtube.mjs ─► YouTube, privacyStatus "public"
```

Next.js ospita gli endpoint e una dashboard di prova. `/api/cron` non è chiamato da nessuno.
La cronologia degli Actions conta 52 run riusciti e 36 falliti tra quelli disponibili.

## Verifica degli elementi già segnalati

| Elemento | Esito |
| --- | --- |
| Next.js 14 e React 18 | Confermato: 14.2.3 |
| `/api/script`, `/api/voiceover` senza autenticazione | Confermato dal codice. In produzione `POST /api/voiceover` con corpo vuoto risponde 400 dal handler, non 401 |
| `vercel.json` senza cron | Confermato |
| Schedulazione commentata | Confermato, e peggio del previsto (C2) |
| FFmpeg con immagine statica | Confermato |
| OAuth2 YouTube | Confermato, refresh token in GitHub Secrets |
| `privacyStatus: "public"` | Confermato in due file |
| Nessun database | Confermato |
| README non aggiornato | Confermato: cita Creatomate, ElevenLabs e cron Vercel |
| Lockfile assente | Confermato |

## Criticità

Stato: ✅ risolta nella PR della Fase A; ⏳ richiede un'azione del proprietario; 🔜 fase successiva.

### Critiche

| ID | Problema | Dove | Stato |
| --- | --- | --- | --- |
| C1 | Endpoint con costo aperti a chiunque, in produzione. Testo senza limite di lunghezza: una sola richiesta poteva consumare budget TTS | `app/api/script`, `app/api/voiceover` | ✅ |
| C2 | `cron.yml` è **invalido**: commentare l'unica voce ha lasciato `schedule:` vuoto. L'ultimo run ha 0 job, quindi il workflow non può partire nemmeno a mano | `.github/workflows/cron.yml` | ✅ reso valido, solo manuale |
| C3 | `test-token.yml` stampa la risposta Google, che contiene un access token, nei log di un repo pubblico. Run del 25/06/2026. GitHub maschera i segreti registrati, non il token ottenuto. Il token vale circa un'ora e i log non sono più scaricabili (HTTP 410), ma per un periodo sono stati pubblici | `.github/workflows/test-token.yml` | ✅ workflow; ⏳ rotazione consigliata |
| C4 | Next.js 14.2.3 con 37 advisory, tra cui due critici (bypass autorizzazione middleware, RCE su Windows) | `package.json` | ✅ 16.4.5 |
| C5 | Pubblicazione pubblica diretta, senza revisione né fonti: i fatti venivano solo dall'output del modello | `upload-youtube.mjs` | ✅ upload privati; 🔜 Fase B |

### Alte

| ID | Problema | Dove | Stato |
| --- | --- | --- | --- |
| A1 | Iniezione SSML: `voiceId`, da richiesta non autenticata, finiva non escapato in un attributo | `lib/tts.ts` | ✅ allowlist |
| A2 | `isAuthorized` confronta con `Bearer ${process.env.CRON_SECRET}`: se la variabile manca, l'header `Bearer undefined` passa. Confronto non a tempo costante. Il valore su Vercel non è verificabile da qui e non è stato provato perché la chiamata avrebbe generato costi | `app/api/cron/route.ts` | ✅ fail-closed |
| A3 | Errori dei provider restituiti al client | route API, `lib/tts.ts` | ✅ |
| A4 | Il ciclo `while (true)` non ha limite e risponde con un `tool_result` fittizio a un tool che è server-side. Gestione `pause_turn` assente, `max_tokens: 1000` basso | `lib/claude.ts` | ✅ |
| A5 | `main` senza protezione, Dependabot disattivato, nessuna CI | Repository | ✅ config e CI; ⏳ impostazioni |
| A6 | Workflow senza `permissions`, timeout e concurrency; dipendenze installate senza lockfile | `cron.yml` | ✅ |

### Medie

| ID | Problema | Stato |
| --- | --- | --- |
| M1 | La dashboard, pubblica, proponeva voci ElevenLabs anche con provider Azure: la voce selezionata non poteva funzionare | ✅ |
| M2 | Default TTS `elevenlabs` nel codice contro `azure` nella documentazione | ✅ |
| M3 | `lib/youtube.ts` inutilizzato, duplicato e con `public` fisso | ✅ rimosso |
| M4 | `.gitignore` assente: rischio concreto di committare `.env.local` | ✅ |
| M5 | La variabile GitHub `NEWS_CATEGORIA=economia` è ignorata: il workflow impone `Italia` | 🔜 superata dalla Fase B |
| M6 | `gaxios` inutilizzato, `CRON_SECRET` passato allo script ma non usato | ✅ |
| M7 | Nessuna dichiarazione per contenuti sintetici, nessun test, titoli con 🔴 | 🔜 |

## Segreti

Controlli su tutta la cronologia, senza stampare valori: chiavi Anthropic, ElevenLabs,
Google, GitHub, JWT e chiavi private. **Nessuna corrispondenza**, con controllo positivo
riuscito sul pattern di scansione. Mai committati `.env`, `.pem` o credenziali. Il secret
scanning di GitHub non riporta alert. Limite: è una scansione a pattern; la CI aggiunge
gitleaks.

**Rotazione consigliata** per C3: rigenerare client secret e refresh token YouTube. Il
refresh token non compare di norma in quella risposta, quindi è una precauzione. Non è stata
eseguita: richiede il tuo accesso a Google.

## Dipendenze

| Pacchetto | Prima | Dopo | Note |
| --- | --- | --- | --- |
| next | 14.2.3 | 16.4.5 | 37 advisory risolti |
| react, react-dom | 18 | 19.3.1 | |
| @anthropic-ai/sdk | 0.24 | 1.6.0 | |
| googleapis | 126 | 189 | catena vulnerabile rimossa |
| gaxios | 6.7.1 | rimosso | |
| zod, vitest, eslint, pglite | assenti | aggiunti | |
| typescript | 5 | 5.9 | non la 7: typescript-eslint richiede <6.1 |

`npm audit` prima: 6 vulnerabilità (1 critica, 1 alta, 4 moderate). Dopo: 0 in produzione, 7 moderate solo negli strumenti di sviluppo (`minimatch`).

## Integrazioni

| Integrazione | Stato |
| --- | --- |
| Claude | Funzionante fino a giugno. Script non verificabili, nessuna citazione |
| Azure TTS | Codice corretto; chiavi su Vercel non verificabili da qui |
| ElevenLabs | Codice corretto, nessun segreto su GitHub |
| YouTube | Upload funzionante fino a giugno. Cause dei fallimenti del 25/06 non ricostruibili: log scaduti |

## Piano di intervento

| Fase | Contenuto | Stato |
| --- | --- | --- |
| A | Audit, sicurezza, dipendenze, CI, schema Supabase | Questa PR |
| B | Fonti, eventi, ranking, script, QC | PR dedicata |
| C | TTS modulare, render, storage | Fondamenta |
| D | Studio | Fondamenta (RLS, RPC) |
| E | YouTube, n8n, analytics | Fondamenta |
| F | Collaudo e rilancio | Da avviare dopo approvazione |

## Azioni richieste al proprietario

1. Impostare `CRON_SECRET` su Vercel **prima** del merge.
2. Rigenerare le credenziali YouTube (C3).
3. Proteggere `main` e attivare Dependabot alerts.
4. Creare il progetto Supabase dedicato.
