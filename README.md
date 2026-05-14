# Flash Info Generator

Pipeline automatica: notizie italiane → script → voiceover → (YouTube)

## Stack
- **Next.js 14** (App Router)
- **Claude API** — generazione script con web search
- **ElevenLabs API** — voiceover italiano
- **Vercel** — hosting + cron job orario

## Setup

### 1. Clone e installa
```bash
git clone <tuo-repo>
cd flash-info
npm install
```

### 2. Variabili d'ambiente
Copia `.env.example` in `.env.local` e inserisci le tue chiavi:
```bash
cp .env.example .env.local
```

### 3. Sviluppo locale
```bash
npm run dev
# → http://localhost:3000/dashboard
```

### 4. Deploy su Vercel
```bash
# Collega il repo GitHub su vercel.com
# Aggiungi le env var nel pannello Vercel:
# ANTHROPIC_API_KEY, ELEVENLABS_API_KEY, CRON_SECRET, NEWS_CATEGORIA, NEWS_NUM
```

Il cron job parte automaticamente ogni ora grazie a `vercel.json`.

## Struttura

```
app/
  api/
    script/route.ts      → POST /api/script       (genera script)
    voiceover/route.ts   → POST /api/voiceover    (genera MP3)
    cron/route.ts        → GET  /api/cron         (flusso completo, orario)
  dashboard/page.tsx     → UI per test manuale
lib/
  claude.ts              → wrapper Anthropic SDK
  elevenlabs.ts          → wrapper ElevenLabs API
vercel.json              → configurazione cron ("0 * * * *" = ogni ora)
```

## Prossimi step
- [ ] Step 3: generazione video con Creatomate
- [ ] Step 4: upload automatico su YouTube
- [ ] Notifiche su errori (email o Slack)
