-- A public, human-reviewed digest of eligible stories not selected for video.
-- Rejected scripts and raw feed content are never exposed to anonymous readers.
alter table public.news_events add column ineligible_reason text
  check (ineligible_reason in ('low_value', 'single_source'));

create table public.digest_items (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null unique references public.news_events (id) on delete restrict,
  headline text not null check (char_length(btrim(headline)) between 12 and 110),
  summary text not null check (char_length(btrim(summary)) between 40 and 360),
  category text,
  source_links jsonb not null check (jsonb_typeof(source_links) = 'array' and jsonb_array_length(source_links) >= 2),
  status text not null default 'published' check (status in ('published', 'retracted')),
  reviewed_by uuid not null references public.admin_users (user_id) on delete restrict,
  published_at timestamptz not null default now(),
  amended_at timestamptz,
  retracted_at timestamptz,
  created_at timestamptz not null default now()
);
create index digest_items_public_idx on public.digest_items (published_at desc) where status = 'published';

alter table public.digest_items enable row level security;
revoke all on public.digest_items from anon, authenticated;
grant select on public.digest_items to anon, authenticated;
create policy digest_public_read on public.digest_items for select to anon, authenticated
  using (status = 'published');
create policy digest_staff_read on public.digest_items for select to authenticated
  using ((select private.is_staff()));

-- The database, not the browser, chooses the source links and enforces the gate.
create or replace function public.publish_digest_item(p_event_id uuid, p_headline text, p_summary text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_event public.news_events;
  v_sources jsonb;
  v_id uuid;
begin
  if not private.is_admin() then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  select * into v_event from public.news_events where id = p_event_id for update;
  if not found or v_event.last_seen_at < now() - interval '24 hours' then
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
      where es.event_id = p_event_id and a.url ~ '^https://'
      order by s.group_key, a.published_at desc
    ) links;
  if coalesce(jsonb_array_length(v_sources), 0) < 2 then
    raise exception 'two independent source groups required' using errcode = 'P0001';
  end if;
  if char_length(btrim(p_headline)) not between 12 and 110
      or char_length(btrim(p_summary)) not between 40 and 360 then
    raise exception 'invalid digest text length' using errcode = '22023';
  end if;
  insert into public.digest_items (event_id, headline, summary, category, source_links, reviewed_by)
  values (p_event_id, btrim(p_headline), btrim(p_summary), v_event.category, v_sources, auth.uid())
  returning id into v_id;
  perform private.write_audit('digest.published', 'digest_item', v_id::text,
    jsonb_build_object('event_id', p_event_id, 'source_groups', jsonb_array_length(v_sources)));
  return v_id;
end $$;

create or replace function public.amend_digest_item(p_item_id uuid, p_headline text, p_summary text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  if char_length(btrim(p_headline)) not between 12 and 110
      or char_length(btrim(p_summary)) not between 40 and 360 then
    raise exception 'invalid digest text length' using errcode = '22023';
  end if;
  update public.digest_items
    set headline = btrim(p_headline), summary = btrim(p_summary), amended_at = now()
    where id = p_item_id and status = 'published';
  if not found then
    raise exception 'published digest item not found' using errcode = 'P0002';
  end if;
  perform private.write_audit('digest.amended', 'digest_item', p_item_id::text);
end $$;

create or replace function public.retract_digest_item(p_item_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  update public.digest_items set status = 'retracted', retracted_at = now()
    where id = p_item_id and status = 'published';
  if not found then
    raise exception 'published digest item not found' using errcode = 'P0002';
  end if;
  perform private.write_audit('digest.retracted', 'digest_item', p_item_id::text);
end $$;

revoke all on function public.publish_digest_item(uuid, text, text) from public, anon, authenticated;
revoke all on function public.amend_digest_item(uuid, text, text) from public, anon, authenticated;
revoke all on function public.retract_digest_item(uuid) from public, anon, authenticated;
grant execute on function public.publish_digest_item(uuid, text, text) to authenticated;
grant execute on function public.amend_digest_item(uuid, text, text) to authenticated;
grant execute on function public.retract_digest_item(uuid) to authenticated;

create view public.editorial_funnel_24h with (security_invoker = true) as
select
  (select count(*) from public.news_events where created_at > now() - interval '24 hours') as events_seen,
  (select count(*) from public.news_events where created_at > now() - interval '24 hours' and ineligible_reason = 'single_source') as single_source,
  (select count(*) from public.news_events where created_at > now() - interval '24 hours' and ineligible_reason = 'low_value') as low_value,
  (select count(*) from public.editorial_candidates where status = 'proposed' and created_at > now() - interval '24 hours') as eligible_unselected,
  (select count(*) from public.scripts where status = 'blocked' and created_at > now() - interval '24 hours') as scripts_blocked,
  (select count(*) from public.digest_items where status = 'published' and published_at > now() - interval '24 hours') as digest_published;
revoke all on public.editorial_funnel_24h from anon;
grant select on public.editorial_funnel_24h to authenticated;
