-- Every state change the Studio can make goes through these functions.
-- Service-only functions are called by trusted GitHub Actions jobs.

create or replace function private.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid());
$$;

create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid() and role = 'admin');
$$;

create or replace function private.require_staff() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_staff() then
    raise exception 'staff access required' using errcode = '42501';
  end if;
end $$;

create or replace function private.setting_int(p_key text, p_field text, p_default integer) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce((select (value ->> p_field)::integer from public.app_settings where key = p_key), p_default);
$$;

create or replace function public.approve_script_version(p_version_id uuid, p_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_version public.script_versions;
begin
  perform private.require_staff();
  select * into v_version from public.script_versions where id = p_version_id;
  if not found then
    raise exception 'script version not found' using errcode = 'P0002';
  end if;
  if v_version.qc_verdict = 'blocked' then
    raise exception 'blocked versions cannot be approved' using errcode = 'P0001';
  end if;
  update public.scripts
    set status = 'approved', approved_version_id = p_version_id
    where id = v_version.script_id;
  perform private.write_audit('script.approved', 'script_version', p_version_id::text,
    jsonb_build_object('note', p_note, 'qc_verdict', v_version.qc_verdict));
end $$;

create or replace function public.reject_script(p_script_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_staff();
  update public.scripts set status = 'rejected', approved_version_id = null where id = p_script_id;
  if not found then
    raise exception 'script not found' using errcode = 'P0002';
  end if;
  perform private.write_audit('script.rejected', 'script', p_script_id::text, jsonb_build_object('reason', p_reason));
end $$;

-- Idempotent and bounded: repeated clicks reuse the job, limits cap the spend.
create or replace function public.enqueue_production_job(p_version_id uuid, p_kind text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_job_id uuid;
  v_key text := p_kind || ':' || p_version_id::text;
  v_approved boolean;
begin
  perform private.require_staff();
  select exists (
    select 1 from public.scripts s where s.approved_version_id = p_version_id and s.status = 'approved'
  ) into v_approved;
  if not v_approved then
    raise exception 'only approved versions can be produced' using errcode = 'P0001';
  end if;

  select id into v_job_id from public.production_jobs where idempotency_key = v_key;
  if found then
    return v_job_id;
  end if;

  if (select count(*) from public.production_jobs where status in ('queued', 'running'))
      >= private.setting_int('job_limits', 'max_active', 3) then
    raise exception 'too many active jobs' using errcode = 'P0001';
  end if;
  if (select count(*) from public.production_jobs where created_at > now() - interval '1 day')
      >= private.setting_int('job_limits', 'max_per_day', 12) then
    raise exception 'daily job limit reached' using errcode = 'P0001';
  end if;

  insert into public.production_jobs (kind, script_version_id, idempotency_key, max_attempts)
  values (p_kind, p_version_id, v_key, private.setting_int('job_limits', 'max_attempts', 3))
  returning id into v_job_id;
  perform private.write_audit('job.enqueued', 'production_job', v_job_id::text, jsonb_build_object('kind', p_kind));
  return v_job_id;
end $$;

create or replace function public.authorize_public_publication(p_queue_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_approved boolean;
begin
  if not private.is_admin() then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  select exists (
    select 1
    from public.publication_queue q
    join public.scripts s on s.approved_version_id = q.script_version_id and s.status = 'approved'
    where q.id = p_queue_id
  ) into v_approved;
  if not v_approved then
    raise exception 'only approved content can be authorized' using errcode = 'P0001';
  end if;
  update public.publication_queue
    set privacy = 'public', public_authorized_by = auth.uid(), public_authorized_at = now()
    where id = p_queue_id;
  perform private.write_audit('publication.public_authorized', 'publication_queue', p_queue_id::text);
end $$;

-- skip locked lets concurrent runners take different jobs, never the same one.
create or replace function public.claim_job(p_job_id uuid, p_runner_id text)
returns public.production_jobs
language plpgsql security definer set search_path = '' as $$
declare
  v_job public.production_jobs;
begin
  update public.production_jobs j
    set status = 'running', attempts = j.attempts + 1, runner_id = p_runner_id, heartbeat_at = now()
    where j.id = (
      select id from public.production_jobs
      where id = p_job_id and status = 'queued' and attempts < max_attempts
      for update skip locked
    )
    returning j.* into v_job;
  return v_job;
end $$;

create or replace function public.finish_job(
  p_job_id uuid, p_status text, p_result jsonb default '{}', p_error_code text default null, p_error_message text default null
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('succeeded', 'failed') then
    raise exception 'invalid final status' using errcode = '22023';
  end if;
  update public.production_jobs
    set status = p_status, result = p_result, error_code = p_error_code,
        error_message = left(p_error_message, 500), finished_at = now()
    where id = p_job_id and status = 'running';
  if not found then
    raise exception 'job is not running' using errcode = 'P0001';
  end if;
  perform private.write_audit('job.finished', 'production_job', p_job_id::text,
    jsonb_build_object('status', p_status, 'error_code', p_error_code));
end $$;

create or replace function public.requeue_stale_jobs(p_stale_minutes integer default 45)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  update public.production_jobs
    set status = case when attempts >= max_attempts then 'failed' else 'queued' end,
        error_code = 'stale_heartbeat',
        finished_at = case when attempts >= max_attempts then now() end
    where status = 'running' and heartbeat_at < now() - make_interval(mins => p_stale_minutes);
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- A registered video stops any retry from uploading it a second time.
create or replace function public.register_youtube_upload(p_queue_id uuid, p_video_id text, p_privacy text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.youtube_publications (queue_id, youtube_video_id, privacy)
  values (p_queue_id, p_video_id, p_privacy);
  update public.publication_queue set status = 'uploaded', last_error = null where id = p_queue_id;
end $$;

create or replace function public.provider_spend_usd(p_since timestamptz default date_trunc('month', now()))
returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(estimated_cost_usd), 0) from public.provider_usage where created_at >= p_since;
$$;

create or replace view public.pipeline_overview with (security_invoker = true) as
select
  (select count(*) from public.news_articles where fetched_at > now() - interval '1 day') as articles_24h,
  (select count(*) from public.editorial_candidates where status = 'proposed') as candidates,
  (select count(*) from public.scripts where status = 'in_review') as scripts_in_review,
  (select count(*) from public.scripts where status = 'blocked') as scripts_blocked,
  (select count(*) from public.production_jobs where status in ('queued', 'running')) as jobs_active,
  (select count(*) from public.production_jobs where status = 'failed') as jobs_failed,
  (select count(*) from public.publication_queue where status in ('pending', 'scheduled')) as publications_pending,
  (select count(*) from public.youtube_publications) as publications_done;
