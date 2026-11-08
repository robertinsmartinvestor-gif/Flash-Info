-- Autopilot: the scheduled workflow takes every step a person took in the Studio,
-- up to a public upload, under rules written here rather than in the job:
--   * a daily cap and a minimum gap between new stories;
--   * only fresh content (versions younger than max_age_hours);
--   * never a blocked script, and never one whose QC raised a finding listed in
--     hold_checks (claims the verifier could not confirm, sensitive topics...):
--     those stay in the Studio for a person;
--   * one switch, autopilot.enabled, stops every step at once.
-- Every automatic decision is written to audit_logs with actor_type 'system'.

insert into public.app_settings (key, value) values
  ('autopilot', '{
    "enabled": true,
    "max_stories_per_day": 3,
    "min_gap_hours": 3,
    "max_age_hours": 24,
    "candidate_max_age_hours": 8,
    "hold_checks": ["verifier", "verifier_unavailable", "verifier_incomplete", "sensitive_topic", "sensational_language"]
  }')
on conflict (key) do nothing;

-- A public row still needs a named approver: a user, or the autopilot policy.
alter table public.publication_queue add column public_authorized_policy text
  check (public_authorized_policy in ('autopilot'));
alter table public.publication_queue drop constraint public_requires_authorization;
alter table public.publication_queue add constraint public_requires_authorization check (
  privacy <> 'public' or (
    public_authorized_at is not null
    -- "is not null", not "= 'autopilot'": a null comparison would let the check pass.
    and (public_authorized_by is not null or public_authorized_policy is not null)
  )
);

create or replace function private.autopilot() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce((select value from public.app_settings where key = 'autopilot'), '{"enabled": false}');
$$;

create or replace function private.require_autopilot() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_settings jsonb := private.autopilot();
begin
  if coalesce((v_settings ->> 'enabled')::boolean, false) is not true then
    raise exception 'autopilot is disabled' using errcode = 'P0001';
  end if;
  return v_settings;
end $$;

-- True when the version is recent enough to be published as news.
create or replace function private.version_is_fresh(p_version_id uuid, p_settings jsonb) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.script_versions v
    where v.id = p_version_id
      and v.created_at > now() - make_interval(hours => coalesce((p_settings ->> 'max_age_hours')::integer, 24))
  );
$$;

-- The checks of enqueue_production_job, without the staff check, so the Studio
-- and the autopilot share one set of limits.
create or replace function private.enqueue_job(p_version_id uuid, p_kind text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_job_id uuid;
  v_key text := p_kind || ':' || p_version_id::text;
begin
  if not exists (
    select 1 from public.scripts s where s.approved_version_id = p_version_id and s.status = 'approved'
  ) then
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

create or replace function public.enqueue_production_job(p_version_id uuid, p_kind text)
returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_staff();
  return private.enqueue_job(p_version_id, p_kind);
end $$;

-- The body of queue_publication, without the staff check.
create or replace function private.queue_item(p_version_id uuid)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_queue_id uuid;
  v_asset_id uuid;
  v_meta jsonb;
  v_title text;
  v_tags text[];
begin
  if not exists (
    select 1 from public.scripts s where s.approved_version_id = p_version_id and s.status = 'approved'
  ) then
    raise exception 'only approved versions can be published' using errcode = 'P0001';
  end if;

  select id into v_queue_id from public.publication_queue where script_version_id = p_version_id;
  if found then
    return v_queue_id;
  end if;

  select id into v_asset_id from public.media_assets
    where script_version_id = p_version_id and kind = 'video' and deleted_at is null
    order by created_at desc limit 1;
  if v_asset_id is null then
    raise exception 'no rendered video for this version' using errcode = 'P0001';
  end if;

  -- YouTube refuses "<" and ">" in titles and descriptions.
  select youtube_metadata into v_meta from public.script_versions where id = p_version_id;
  v_title := left(btrim(translate(coalesce(v_meta ->> 'title', ''), '<>', '')), 100);
  if v_title = '' then
    raise exception 'version has no title' using errcode = 'P0001';
  end if;
  v_tags := array(
    select left(btrim(translate(tag, '<>,', '')), 30)
    from jsonb_array_elements_text(case when jsonb_typeof(v_meta -> 'tags') = 'array' then v_meta -> 'tags' else '[]' end) as tag
    where btrim(translate(tag, '<>,', '')) <> ''
    limit 8
  );

  insert into public.publication_queue (script_version_id, video_asset_id, privacy, contains_synthetic_media, title, description, tags)
  values (
    p_version_id, v_asset_id, 'private', true, v_title,
    left(translate(coalesce(v_meta ->> 'description', ''), '<>', ''), 5000), v_tags
  )
  returning id into v_queue_id;
  perform private.write_audit('publication.queued', 'publication_queue', v_queue_id::text, jsonb_build_object('version_id', p_version_id));
  return v_queue_id;
end $$;

create or replace function public.queue_publication(p_version_id uuid)
returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_staff();
  return private.queue_item(p_version_id);
end $$;

-- Picks the best fresh Flash candidate, within the daily cap and the gap.
-- Returns null when there is nothing to do.
create or replace function public.autopilot_select_candidate()
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_settings jsonb := private.require_autopilot();
  v_id uuid;
begin
  if (select count(*) from public.audit_logs
      where action = 'candidate.auto_selected' and created_at > now() - interval '1 day')
      >= coalesce((v_settings ->> 'max_stories_per_day')::integer, 3) then
    return null;
  end if;
  if exists (select 1 from public.audit_logs
      where action = 'candidate.auto_selected'
        and created_at > now() - make_interval(hours => coalesce((v_settings ->> 'min_gap_hours')::integer, 3))) then
    return null;
  end if;

  select c.id into v_id from public.editorial_candidates c
    where c.status = 'proposed' and c.format = 'flash'
      and c.created_at > now() - make_interval(hours => coalesce((v_settings ->> 'candidate_max_age_hours')::integer, 8))
    order by c.score desc, c.created_at desc
    limit 1
    for update skip locked;
  if v_id is null then
    return null;
  end if;

  update public.editorial_candidates set status = 'selected', decided_at = now() where id = v_id;
  perform private.write_audit('candidate.auto_selected', 'editorial_candidate', v_id::text);
  return v_id;
end $$;

-- Approves the latest version of a script when the rules allow it. Returns false,
-- without raising, when the script must wait for a person.
create or replace function public.autopilot_approve_script(p_script_id uuid)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_settings jsonb := private.require_autopilot();
  v_version public.script_versions;
  v_held text[];
begin
  select v.* into v_version from public.script_versions v
    join public.scripts s on s.id = v.script_id
    where s.id = p_script_id and s.status in ('draft', 'in_review')
    order by v.version desc limit 1;
  if not found or v_version.qc_verdict = 'blocked' or not private.version_is_fresh(v_version.id, v_settings) then
    return false;
  end if;

  v_held := array(
    select distinct f ->> 'check'
    from jsonb_array_elements(case when jsonb_typeof(v_version.qc_report -> 'findings') = 'array' then v_version.qc_report -> 'findings' else '[]' end) f
    where (f ->> 'severity') = 'blocker'
       or (f ->> 'check') in (select jsonb_array_elements_text(coalesce(v_settings -> 'hold_checks', '[]')))
  );
  if cardinality(v_held) > 0 then
    perform private.write_audit('script.auto_held', 'script_version', v_version.id::text, jsonb_build_object('checks', v_held));
    return false;
  end if;

  update public.scripts set status = 'approved', approved_version_id = v_version.id where id = p_script_id;
  perform private.write_audit('script.auto_approved', 'script_version', v_version.id::text,
    jsonb_build_object('qc_verdict', v_version.qc_verdict));
  return true;
end $$;

create or replace function public.autopilot_enqueue_job(p_version_id uuid, p_kind text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_settings jsonb := private.require_autopilot();
begin
  if p_kind not in ('tts', 'render') then
    raise exception 'invalid kind' using errcode = '22023';
  end if;
  if not private.version_is_fresh(p_version_id, v_settings) then
    raise exception 'version is too old for the autopilot' using errcode = 'P0001';
  end if;
  return private.enqueue_job(p_version_id, p_kind);
end $$;

-- Queues the video and authorizes it as public in one step. The authorization
-- has no user behind it: public_authorized_by stays null, public_authorized_policy
-- and the audit row name the autopilot.
create or replace function public.autopilot_queue_public(p_version_id uuid)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_settings jsonb := private.require_autopilot();
  v_queue_id uuid;
begin
  if not private.version_is_fresh(p_version_id, v_settings) then
    raise exception 'version is too old for the autopilot' using errcode = 'P0001';
  end if;
  v_queue_id := private.queue_item(p_version_id);
  update public.publication_queue
    set privacy = 'public', public_authorized_at = now(), public_authorized_policy = 'autopilot'
    where id = v_queue_id and status = 'pending' and public_authorized_at is null;
  if found then
    perform private.write_audit('publication.public_authorized', 'publication_queue', v_queue_id::text,
      jsonb_build_object('by', 'autopilot'));
  end if;
  return v_queue_id;
end $$;

revoke all on function private.autopilot() from public, anon, authenticated;
revoke all on function private.require_autopilot() from public, anon, authenticated;
revoke all on function private.version_is_fresh(uuid, jsonb) from public, anon, authenticated;
revoke all on function private.enqueue_job(uuid, text) from public, anon, authenticated;
revoke all on function private.queue_item(uuid) from public, anon, authenticated;

revoke all on function public.enqueue_production_job(uuid, text) from public, anon, authenticated;
grant execute on function public.enqueue_production_job(uuid, text) to authenticated;
revoke all on function public.queue_publication(uuid) from public, anon, authenticated;
grant execute on function public.queue_publication(uuid) to authenticated;

revoke all on function public.autopilot_select_candidate() from public, anon, authenticated;
revoke all on function public.autopilot_approve_script(uuid) from public, anon, authenticated;
revoke all on function public.autopilot_enqueue_job(uuid, text) from public, anon, authenticated;
revoke all on function public.autopilot_queue_public(uuid) from public, anon, authenticated;
grant execute on function public.autopilot_select_candidate() to service_role;
grant execute on function public.autopilot_approve_script(uuid) to service_role;
grant execute on function public.autopilot_enqueue_job(uuid, text) to service_role;
grant execute on function public.autopilot_queue_public(uuid) to service_role;
