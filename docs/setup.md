# Setup dell'ambiente

## Locale

```bash
npm ci
npm run check
```

I test non richiedono credenziali né Docker.

## Supabase

Crea un progetto **dedicato**, separato da Lepefy. Il piano free ammette 2 progetti
attivi: se Lepefy ne occupa già due serve una decisione (vedi `architecture.md`).

```bash
npx supabase login
npx supabase link --project-ref <ref-del-progetto-ogniora>
npx supabase db push
```

Poi aggiungi gli utenti dello Studio: crea l'utente in Auth e inserisci in SQL Editor:

```sql
insert into public.admin_users (user_id, role) values ('<uuid>', 'admin');
```

Solo chi ha `role = 'admin'` può autorizzare una pubblicazione pubblica o cambiare la voce.

Lo Studio usa `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`, lette durante la build.

## Provare la raccolta senza credenziali

```bash
npm run job:ingest -- --dry-run
```

Scarica i feed reali e stampa gli eventi. Non scrive nulla e non chiama provider IA.

## Test d'integrazione

`npm run test:integration` esercita `SupabaseStore` su PostgREST reale. Serve uno stack
**usa e getta**: i test scrivono righe. Se sulla macchina gira lo stack locale di un altro
progetto, non usarlo.

```bash
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=... npm run test:integration
```

## Variabili e segreti

L'elenco è in `.env.example`. Su GitHub vanno in *Settings → Secrets and variables →
Actions*. `SUPABASE_SERVICE_ROLE_KEY` non deve mai arrivare al browser.

## Vercel (percorso legacy)

Prima di fare il merge della Fase A verifica che `CRON_SECRET` sia impostato su Vercel
con lo stesso valore del segreto GitHub: senza, tutti gli endpoint rispondono 401.
