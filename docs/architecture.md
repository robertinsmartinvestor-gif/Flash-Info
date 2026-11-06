# Architettura di OgniOra 2.0

## Principi

1. **Nessun fatto senza evidenza.** Il modello riceve un pacchetto chiuso di articoli e
   ogni affermazione deve citarne uno con una frase verificabile. Il QC è codice
   deterministico: un modello non approva un altro modello.
2. **Il pubblico è irraggiungibile per default.** Tre barriere indipendenti: `decideUpload()`,
   l'interruttore `ALLOW_PUBLIC_PUBLICATION`, i vincoli del database.
3. **Job asincroni e idempotenti.** Nessuna richiesta HTTP lunga. Ogni job ha una chiave
   univoca; ripetere un'azione non produce duplicati né costi.
4. **€0 di costi fissi.** Il calcolo pesante gira su GitHub Actions, il resto è statico.

## Flusso

```
 n8n (solo orchestrazione)
   │ workflow_dispatch con id univoco
   ▼
 GitHub Actions ──── RSS ──► News Intelligence ──► Editorial Engine ──► Quality Control
   │                                                                         │
   │ service role                                                            ▼
   ▼                                                                    Supabase
 Media Production ◄── job approvati ◄── RPC ◄── OgniOra Studio (statico) ◄── Auth + RLS
   │
   ▼
 Distribution ──► YouTube (privato/non in elenco) ──► Analytics
```

| Componente | Dove gira | Moduli |
| --- | --- | --- |
| News Intelligence | GitHub Actions | `src/news` |
| Editorial Engine | GitHub Actions | `src/editorial`, `src/providers` |
| Quality Control | GitHub Actions | `src/quality` |
| Media Production | GitHub Actions | `src/media` |
| Distribution | GitHub Actions | `src/distribution` |
| OgniOra Studio | Cloudflare (statico) | `app/` |
| Stato | Supabase | `supabase/migrations` |

## Decisioni

### D1. Studio: Next.js in export statico su Cloudflare

Next.js resta, ma senza server: `output: "export"` servito come static assets, con
Supabase Auth, RLS e RPC al posto delle route API.

- Il piano free dei Workers concede 10 ms di CPU per richiesta. Il limite di dimensione da
  3 MB è stato rimosso (ora 64 MiB), ma il rendering server di Next.js tramite OpenNext non
  rientra in modo affidabile nei 10 ms.
- Le richieste agli static assets sono gratuite e illimitate.
- Le azioni con costo passano da RPC con ruolo e limiti verificati nel database, quindi il
  backend applicativo non serve.
- Conseguenza: le pagine di dettaglio usano query string, non segmenti dinamici. Le route
  `app/api` legacy vanno rimosse al passaggio, perché incompatibili con l'export.

Alternativa scartata: OpenNext sul piano Workers a pagamento (costo fisso non necessario).

### D2. Pacchetto unico, niente monorepo

Il dominio sta in `src/` con confini per cartella. Remotion, che è pesante e serve solo al
rendering, avrà un proprio `package.json` in `video/`.

### D3. n8n non calcola

n8n lancia `workflow_dispatch` e legge gli stati. Fonti, IA e rendering stanno su Actions,
così una sola istanza n8n resta leggera e gli altri progetti non ne risentono.

### D4. RSS come fonte primaria, niente web search nello script

La vecchia pipeline chiedeva al modello di cercare e scrivere insieme: fonti non tracciate e
nessuna verifica possibile. Ora la raccolta è codice, con URL e date registrati.

### D5. Claude tramite SDK, modelli da configurazione

Ogni funzione sceglie provider e modello da configurazione, con fallback. I default sono
un'ipotesi di partenza: la scelta va fatta col benchmark, non col prezzo di listino.

## Vincoli verificati (novembre 2026)

| Servizio | Vincolo | Impatto |
| --- | --- | --- |
| Cloudflare Workers Free | 10 ms CPU, 100.000 richieste/giorno, static assets illimitati | Studio solo statico |
| Supabase Free | 2 progetti attivi, pausa dopo 1 settimana di inattività, 500 MB DB, 1 GB storage, 50 MB per file | Retention stretta; l'ingestione periodica mantiene attivo il progetto |
| GitHub Actions | Gratis sui runner standard per repo pubblici; log e artifact pubblici | Anteprime su Supabase, non negli artifact |
| YouTube Data API | Dal 2 nov 2026 le API non verificate non sono più limitate al privato; senza `privacyStatus` il default è **public**; `containsSyntheticMedia` scrivibile in insert; quote `videos.insert` in un bucket separato | Il privacy status va sempre inviato. Controllare la quota in Google Cloud Console |
| Remotion | Gratuito fino a 3 persone, anche commerciale; da 4 serve licenza | Da confermare in base alla struttura aziendale |
| Azure Speech F0 | 500.000 caratteri neurali/mese, 3.000 per file; thread Microsoft indicano diritti commerciali sull'output solo sui piani a pagamento | Verificare le condizioni prima di monetizzare; S0 va deciso esplicitamente |

Fonti: [Cloudflare limits](https://developers.cloudflare.com/workers/platform/limits/),
[Cloudflare pricing](https://developers.cloudflare.com/workers/platform/pricing/),
[Supabase pricing](https://supabase.com/pricing),
[YouTube revision history](https://developers.google.com/youtube/data/revision_history),
[YouTube videos](https://developers.google.com/youtube/v3/docs/videos),
[Remotion license](https://www.remotion.dev/docs/license/faq),
[Azure Speech pricing](https://azure.microsoft.com/en-us/pricing/details/speech/),
[Q&A Azure F0](https://learn.microsoft.com/en-us/answers/questions/6045956/can-i-use-azure-tts-prebuilt-neural-voices-free-f0).

## Sicurezza

- **anon**: nessun accesso a tabelle o RPC.
- **authenticated non staff**: nessuna riga visibile.
- **staff** (`admin_users`): legge tutto, scrive solo tramite RPC controllate.
- **admin**: unico ruolo che può autorizzare il pubblico.
- **service role**: solo job GitHub Actions.
- `script_versions` e `audit_logs` sono immutabili; ogni cambio di stato di pubblicazione
  viene registrato da un trigger.
