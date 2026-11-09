-- max_stories_per_day counts the stories picked on the current calendar day
-- (Europe/Rome), not in the last 24 hours. With the rolling window a story
-- picked yesterday afternoon still filled a place at today's 12:00 slot, so
-- the slot published nothing.

create or replace function public.autopilot_select_candidate()
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_settings jsonb := private.require_autopilot();
  v_id uuid;
begin
  -- Missing key: any hour, as before this migration. Present: only those hours.
  if v_settings ? 'publish_hours' and not (
    to_char(now() at time zone 'Europe/Rome', 'HH24')
      in (select jsonb_array_elements_text(case when jsonb_typeof(v_settings -> 'publish_hours') = 'array' then v_settings -> 'publish_hours' else '[]' end))
  ) then
    return null;
  end if;
  if (select count(*) from public.audit_logs
      where action = 'candidate.auto_selected'
        and created_at >= (date_trunc('day', now() at time zone 'Europe/Rome') at time zone 'Europe/Rome'))
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

revoke all on function public.autopilot_select_candidate() from public, anon, authenticated;
grant execute on function public.autopilot_select_candidate() to service_role;
