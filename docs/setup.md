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

Solo chi ha `role = 'admin'` può autorizzare una pubblicazione pubblica.

## Variabili e segreti

L'elenco è in `.env.example`. Su GitHub vanno in *Settings → Secrets and variables →
Actions*. `SUPABASE_SERVICE_ROLE_KEY` non deve mai arrivare al browser.

## Vercel (percorso legacy)

Prima di fare il merge della Fase A verifica che `CRON_SECRET` sia impostato su Vercel
con lo stesso valore del segreto GitHub: senza, tutti gli endpoint rispondono 401.
