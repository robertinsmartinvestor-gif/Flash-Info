-- A public, human-reviewed digest of eligible stories not selected for video,
-- plus the counters that explain what the pipeline left out.
-- Raw feed content, candidates and scripts are never exposed to anonymous readers:
-- anon reads only published digest columns and a minimal retraction notice.

-- ---------------------------------------------------------------------------
-- Funnel tracking: when each counter started, so the Studio never presents
-- older, unclassified data as if it were complete.
-- ---------------------------------------------------------------------------
create table public.metric_tracking (
  metric text primary key,
  since timestamptz not null default now()
);
insert into public.metric_tracking (metric) values ('ineligible_reason'), ('ingest_drops');

alter table public.news_events add column ineligible_reason text
  check (ineligible_reason in ('low_value', 'single_source'));

-- One row per ingest run, written by the trusted job (service role).
create table public.ingest_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  sources_total integer not null check (sources_total >= 0),
  sources_failed integer not null check (sources_failed >= 0),
  items_seen integer not null check (items_seen >= 0),
  dropped_undated integer not null default 0 check (dropped_undated >= 0),
  dropped_out_of_window integer not null default 0 check (dropped_out_of_window >= 0),
  dropped_bad_url integer not null default 0 check (dropped_bad_url >= 0),
  dropped_duplicate integer not null default 0 check (dropped_duplicate >= 0),
  already_stored integer not null default 0 check (already_stored >= 0),
  new_articles integer not null check (new_articles >= 0),
  events_saved integer not null check (events_saved >= 0),
  candidates integer not null check (candidates >= 0)
);
create index ingest_runs_started_idx on public.ingest_runs (started_at desc);

alter table public.metric_tracking enable row level security;
alter table public.ingest_runs enable row level security;
revoke all on public.metric_tracking, public.ingest_runs from anon, authenticated;
grant select on public.metric_tracking, public.ingest_runs to authenticated;
create policy staff_read on public.metric_tracking for select to authenticated using ((select private.is_staff()));
create policy staff_read on public.ingest_runs for select to authenticated using ((select private.is_staff()));

-- ---------------------------------------------------------------------------
-- Digest items
-- ---------------------------------------------------------------------------
create table public.digest_items (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9-]+$' and char_length(slug) <= 100),
  event_id uuid not null unique references public.news_events (id) on delete restrict,
  headline text not null check (char_length(btrim(headline)) between 12 and 110),
  summary text not null check (char_length(btrim(summary)) between 40 and 360),
  category text,
  source_links jsonb not null check (jsonb_typeof(source_links) = 'array' and jsonb_array_length(source_links) >= 2),
  status text not null default 'published' check (status in ('published', 'retracted')),
  reviewed_by uuid not null references public.admin_users (user_id) on delete restrict,
  published_at timestamptz not null default now(),
  amended_at timestamptz,
  amendment_note text check (amendment_note is null or char_length(btrim(amendment_note)) between 10 and 200),
  retracted_at timestamptz,
  retraction_note text check (retraction_note is null or char_length(btrim(retraction_note)) between 10 and 200),
  created_at timestamptz not null default now(),
  check ((status = 'retracted') = (retracted_at is not null and retraction_note is not null)),
  check ((amended_at is null) = (amendment_note is null))
);
create index digest_items_public_idx on public.digest_items (published_at desc) where status = 'published';

alter table public.digest_items enable row level security;
revoke all on public.digest_items from anon, authenticated;
-- Column grants: the reviewer's id stays private to the database.
grant select (id, slug, headline, summary, category, source_links, published_at, amended_at, amendment_note)
  on public.digest_items to anon;
grant select (id, slug, event_id, headline, summary, category, source_links, status, published_at,
  amended_at, amendment_note, retracted_at, retraction_note, created_at)
  on public.digest_items to authenticated;
create policy digest_public_read on public.digest_items for select to anon, authenticated
  using (status = 'published');
create policy digest_staff_read on public.digest_items for select to authenticated
  using ((select private.is_staff()));

-- ---------------------------------------------------------------------------
-- Helpers: slug and copy detection
-- ---------------------------------------------------------------------------
create or replace function private.fold_words(p_text text) returns text[]
language sql immutable set search_path = '' as $$
  select coalesce(array_remove(regexp_split_to_array(
    translate(lower(coalesce(p_text, '')), 'àáâäãèéêëìíîïòóôöõùúûüçñ’''', 'aaaaaeeeeiiiiooooouuuucn  '),
    '[^a-z0-9]+'), ''), '{}');
$$;

create or replace function private.slugify(p_text text) returns text
language sql immutable set search_path = '' as $$
  select coalesce(nullif(btrim(left(array_to_string(private.fold_words(p_text), '-'), 70), '-'), ''), 'notizia');
$$;

-- Word sequences of length p_n, after folding case, accents and punctuation.
create or replace function private.ngrams(p_text text, p_n integer) returns setof text
language sql immutable set search_path = '' as $$
  select array_to_string(w[i:i + p_n - 1], ' ')
  from (select private.fold_words(p_text) as w) words, generate_series(1, cardinality(w) - p_n + 1) as i;
$$;

-- Why a text copies the event's source articles, or null when it does not.
-- Same rule as src/public/originality.ts: the headline may not share 6 words in
-- a row with a source title (or equal it); the summary may not share 8 words in a
-- row with a source title or RSS summary.
create or replace function private.digest_copy_reason(p_event_id uuid, p_headline text, p_summary text) returns text
language sql stable set search_path = '' as $$
  with src as (
    select a.title, a.summary from public.news_event_sources es
    join public.news_articles a on a.id = es.article_id
    where es.event_id = p_event_id
  )
  select case
    when exists (select 1 from src where private.fold_words(src.title) = private.fold_words(p_headline))
      or exists (select private.ngrams(p_headline, 6) intersect select private.ngrams(src.title, 6) from src)
      then 'headline_copies_source'
    when exists (select private.ngrams(p_summary, 8)
        intersect (select private.ngrams(src.title, 8) from src
                   union all select private.ngrams(src.summary, 8) from src))
      then 'summary_copies_source'
  end;
$$;

-- ---------------------------------------------------------------------------
-- Publication path. The database, not the browser, picks the source links and
-- enforces every gate: admin, fresh event, unselected candidate, no script of
-- any status (a blocked or held script never reaches the site), two source
-- groups with https links, original text.
-- ---------------------------------------------------------------------------
create or replace function public.publish_digest_item(p_event_id uuid, p_headline text, p_summary text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_event public.news_events;
  v_sources jsonb;
  v_id uuid := gen_random_uuid();
  v_copy text;
begin
  if not private.is_admin() then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_headline, ''))) not between 12 and 110
      or char_length(btrim(coalesce(p_summary, ''))) not between 40 and 360 then
    raise exception 'invalid digest text length' using errcode = '22023';
  end if;
  select * into v_event from public.news_events where id = p_event_id for update;
  if not found or v_event.last_seen_at < now() - interval '24 hours' or v_event.status = 'archived' then
    raise exception 'event is absent or stale' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.editorial_candidates c
      where c.event_id = p_event_id and c.format = 'flash' and c.status = 'proposed') then
    raise exception 'only unselected eligible events can enter the digest' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.scripts s join public.editorial_candidates c on c.id = s.candidate_id
      where c.event_id = p_event_id) then
    raise exception 'scripted events require the script review path' using errcode = 'P0001';
  end if;
  select jsonb_agg(jsonb_build_object('publisher', publisher, 'url', url) order by publisher)
    into v_sources from (
      select distinct on (s.group_key) a.publisher, a.url
      from public.news_event_sources es
      join public.news_articles a on a.id = es.article_id
      join public.news_sources s on s.id = a.source_id
      where es.event_id = p_event_id and a.url ~ '^https://[^\s"<>]+$'
      order by s.group_key, a.published_at desc
    ) links;
  if coalesce(jsonb_array_length(v_sources), 0) < 2 then
    raise exception 'two independent source groups required' using errcode = 'P0001';
  end if;
  v_copy := private.digest_copy_reason(p_event_id, p_headline, p_summary);
  if v_copy is not null then
    raise exception 'digest text copies the sources: %', v_copy using errcode = '22023';
  end if;
  insert into public.digest_items (id, slug, event_id, headline, summary, category, source_links, reviewed_by)
  values (
    v_id,
    to_char(now() at time zone 'Europe/Rome', 'YYYY-MM-DD') || '-' || private.slugify(p_headline) || '-'
      || left(replace(v_id::text, '-', ''), 6),
    p_event_id, btrim(p_headline), btrim(p_summary), v_event.category, v_sources, auth.uid()
  );
  perform private.write_audit('digest.published', 'digest_item', v_id::text,
    jsonb_build_object('event_id', p_event_id, 'source_groups', jsonb_array_length(v_sources)));
  return v_id;
end $$;

-- A correction keeps the permalink and shows its date and public note.
create or replace function public.amend_digest_item(p_item_id uuid, p_headline text, p_summary text, p_note text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_event_id uuid;
  v_copy text;
begin
  if not private.is_admin() then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_headline, ''))) not between 12 and 110
      or char_length(btrim(coalesce(p_summary, ''))) not between 40 and 360 then
    raise exception 'invalid digest text length' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_note, ''))) not between 10 and 200 then
    raise exception 'a public correction note is required' using errcode = '22023';
  end if;
  select event_id into v_event_id from public.digest_items where id = p_item_id and status = 'published' for update;
  if not found then
    raise exception 'published digest item not found' using errcode = 'P0002';
  end if;
  v_copy := private.digest_copy_reason(v_event_id, p_headline, p_summary);
  if v_copy is not null then
    raise exception 'digest text copies the sources: %', v_copy using errcode = '22023';
  end if;
  update public.digest_items
    set headline = btrim(p_headline), summary = btrim(p_summary), amended_at = now(), amendment_note = btrim(p_note)
    where id = p_item_id;
  perform private.write_audit('digest.amended', 'digest_item', p_item_id::text, jsonb_build_object('note', btrim(p_note)));
end $$;

-- A retraction hides the content; the permalink keeps a dated notice and the reason.
create or replace function public.retract_digest_item(p_item_id uuid, p_note text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_note, ''))) not between 10 and 200 then
    raise exception 'a public retraction note is required' using errcode = '22023';
  end if;
  update public.digest_items set status = 'retracted', retracted_at = now(), retraction_note = btrim(p_note)
    where id = p_item_id and status = 'published';
  if not found then
    raise exception 'published digest item not found' using errcode = 'P0002';
  end if;
  perform private.write_audit('digest.retracted', 'digest_item', p_item_id::text, jsonb_build_object('note', btrim(p_note)));
end $$;

-- What anonymous readers may know about retracted items: never headline or summary.
create or replace function public.digest_retractions(p_slug text default null)
returns table (slug text, published_at timestamptz, retracted_at timestamptz, retraction_note text)
language sql stable security definer set search_path = '' as $$
  select d.slug, d.published_at, d.retracted_at, d.retraction_note
  from public.digest_items d
  where d.status = 'retracted' and (p_slug is null or d.slug = p_slug)
  order by d.retracted_at desc
  limit 100;
$$;

revoke all on function private.fold_words(text), private.slugify(text), private.ngrams(text, integer),
  private.digest_copy_reason(uuid, text, text) from public, anon, authenticated;
revoke all on function public.publish_digest_item(uuid, text, text) from public, anon, authenticated;
revoke all on function public.amend_digest_item(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.retract_digest_item(uuid, text) from public, anon, authenticated;
revoke all on function public.digest_retractions(text) from public, anon, authenticated;
grant execute on function public.publish_digest_item(uuid, text, text) to authenticated;
grant execute on function public.amend_digest_item(uuid, text, text, text) to authenticated;
grant execute on function public.retract_digest_item(uuid, text) to authenticated;
grant execute on function public.digest_retractions(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Funnel for the last 24 hours (staff only, through RLS of the base tables).
-- ---------------------------------------------------------------------------
create view public.editorial_funnel_24h with (security_invoker = true) as
with w as (select now() - interval '24 hours' as since),
runs as (select r.* from public.ingest_runs r, w where r.started_at > w.since),
events as (select e.* from public.news_events e, w where e.created_at > w.since)
select
  (select count(*) from runs) as ingest_runs,
  (select coalesce(sum(items_seen), 0) from runs) as feed_items,
  (select coalesce(sum(dropped_undated), 0) from runs) as dropped_undated,
  (select coalesce(sum(dropped_out_of_window), 0) from runs) as dropped_out_of_window,
  (select coalesce(sum(dropped_bad_url), 0) from runs) as dropped_bad_url,
  (select coalesce(sum(dropped_duplicate), 0) from runs) as dropped_duplicate,
  (select coalesce(sum(new_articles), 0) from runs) as new_articles,
  (select count(*) from events) as events_seen,
  (select count(*) from events where ineligible_reason = 'single_source') as single_source,
  (select count(*) from events where ineligible_reason = 'low_value') as low_value,
  -- Ineligible events saved before the migration: no candidate and no recorded reason.
  (select count(*) from events e where e.ineligible_reason is null
     and not exists (select 1 from public.editorial_candidates c where c.event_id = e.id)) as unclassified,
  (select count(*) from public.editorial_candidates c join public.news_events e on e.id = c.event_id, w
     where c.format = 'flash' and c.status = 'proposed' and e.last_seen_at > w.since) as eligible_unselected,
  (select count(*) from public.scripts s, w where s.status = 'blocked' and s.updated_at > w.since) as scripts_blocked,
  (select count(distinct a.entity_id) from public.audit_logs a, w
     where a.action = 'script.auto_held' and a.created_at > w.since) as scripts_held,
  (select count(*) from public.digest_items d, w where d.status = 'published' and d.published_at > w.since) as digest_published,
  (select since from public.metric_tracking where metric = 'ineligible_reason') as classified_since,
  (select since from public.metric_tracking where metric = 'ingest_drops') as drops_since;
revoke all on public.editorial_funnel_24h from anon, authenticated;
grant select on public.editorial_funnel_24h to authenticated;
