alter table public.editorial_candidates drop constraint editorial_candidates_status_check;
alter table public.editorial_candidates add constraint editorial_candidates_status_check
  check (status in ('proposed', 'selected', 'composing', 'rejected', 'scripted', 'expired'));

-- One compose run per candidate. A failed run stays in 'composing' for an
-- editor to look at: an automatic retry could repeat the spend on every poll.
create or replace function public.claim_candidate(p_candidate_id uuid)
returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update public.editorial_candidates set status = 'composing'
    where id = p_candidate_id and status = 'selected';
  return found;
end $$;

-- Moves a queue item to 'uploading' exactly once. An item left in 'uploading' by
-- a crash is not retried: YouTube may have the video, and only a person can tell.
create or replace function public.begin_upload(p_queue_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.publication_queue;
  v_approved boolean;
  v_path text;
begin
  select exists (
    select 1
    from public.publication_queue q
    join public.scripts s on s.approved_version_id = q.script_version_id and s.status = 'approved'
    where q.id = p_queue_id
  ) into v_approved;

  update public.publication_queue
    set status = 'uploading', last_error = null
    where id = p_queue_id
      and status in ('pending', 'scheduled', 'failed')
      and not exists (select 1 from public.youtube_publications y where y.queue_id = p_queue_id)
      and v_approved
    returning * into v_row;
  if not found then
    return null;
  end if;

  select storage_path into v_path from public.media_assets
    where id = v_row.video_asset_id and deleted_at is null;
  return to_jsonb(v_row) || jsonb_build_object('storage_path', v_path, 'script_approved', v_approved);
end $$;

create or replace function public.fail_upload(p_queue_id uuid, p_error text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.publication_queue set status = 'failed', last_error = left(p_error, 300)
    where id = p_queue_id and status = 'uploading';
end $$;

create or replace function public.expired_media_assets(p_limit integer default 100)
returns table (id uuid, storage_bucket text, storage_path text)
language sql stable security definer set search_path = '' as $$
  select a.id, a.storage_bucket, a.storage_path
  from public.media_assets a
  where a.deleted_at is null and a.expires_at < now()
    -- A video waiting for or going through upload must survive its expiry date.
    and not exists (
      select 1 from public.publication_queue q
      where q.video_asset_id = a.id and q.status in ('pending', 'scheduled', 'uploading')
    )
  order by a.expires_at
  limit p_limit;
$$;

create or replace function public.mark_media_deleted(p_ids uuid[])
returns void
language sql security definer set search_path = '' as $$
  update public.media_assets set deleted_at = now() where id = any(p_ids);
$$;

-- Evidence used by a script survives in script_versions.evidence, so raw
-- articles can go. Audit logs are append-only and are not touched here.
create or replace function public.run_retention()
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_settings jsonb := (select value from public.app_settings where key = 'retention_days');
  v_articles integer;
  v_usage integer;
begin
  delete from public.news_articles
    where fetched_at < now() - make_interval(days => (v_settings ->> 'articles')::integer);
  get diagnostics v_articles = row_count;
  delete from public.provider_usage
    where created_at < now() - make_interval(days => (v_settings ->> 'provider_usage')::integer);
  get diagnostics v_usage = row_count;
  return jsonb_build_object('articles', v_articles, 'provider_usage', v_usage);
end $$;

revoke all on function public.claim_candidate(uuid) from public, anon, authenticated;
revoke all on function public.begin_upload(uuid) from public, anon, authenticated;
revoke all on function public.fail_upload(uuid, text) from public, anon, authenticated;
revoke all on function public.expired_media_assets(integer) from public, anon, authenticated;
revoke all on function public.mark_media_deleted(uuid[]) from public, anon, authenticated;
revoke all on function public.run_retention() from public, anon, authenticated;

grant execute on function public.claim_candidate(uuid) to service_role;
grant execute on function public.begin_upload(uuid) to service_role;
grant execute on function public.fail_upload(uuid, text) to service_role;
grant execute on function public.expired_media_assets(integer) to service_role;
grant execute on function public.mark_media_deleted(uuid[]) to service_role;
grant execute on function public.run_retention() to service_role;
