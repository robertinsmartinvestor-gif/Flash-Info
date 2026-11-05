# OgniOra

Piattaforma editoriale che individua notizie rilevanti, le verifica, ne ricava contenuti
audiovisivi originali e li pubblica su YouTube dopo una revisione umana.

Stato: **in ricostruzione (OgniOra 2.0)**. Nessun video viene pubblicato automaticamente.

| Documento | Contenuto |
| --- | --- |
| [docs/audit-2026.md](docs/audit-2026.md) | Stato del sistema, criticità, piano di intervento |
| [docs/architecture.md](docs/architecture.md) | Architettura, decisioni e limiti dei servizi |
| [docs/editorial-engine.md](docs/editorial-engine.md) | Raccolta, eventi, script e controlli |
| [docs/operations.md](docs/operations.md) | Workflow, n8n, pubblicazione, rotazione segreti |
| [docs/status.md](docs/status.md) | Criteri MVP: cosa è verificato e cosa no |
| [docs/setup.md](docs/setup.md) | Come riprodurre l'ambiente |
| [AGENTS.md](AGENTS.md) | Regole di lavoro sul repository |

## Sviluppo

Serve Node.js 24.

```bash
npm ci
cp .env.example .env.local
npm run check
npm run dev
```

## Percorso legacy

`app/api/*`, `lib/` e `scripts/` sono la vecchia pipeline. Restano finché la nuova non è
collaudata, ma tutti gli endpoint richiedono autenticazione e gli upload sono privati.
Il workflow `cron.yml` è solo manuale.
