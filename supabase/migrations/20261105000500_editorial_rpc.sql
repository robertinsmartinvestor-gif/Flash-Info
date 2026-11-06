-- Studio picks which candidates get a script: generation costs money, so only
-- selected candidates reach the compose job.
create or replace function public.select_candidate(p_candidate_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_staff();
  update public.editorial_candidates
    set status = 'selected', decided_by = auth.uid(), decided_at = now()
    where id = p_candidate_id and status = 'proposed';
  if not found then
    raise exception 'candidate is not open' using errcode = 'P0001';
  end if;
  perform private.write_audit('candidate.selected', 'editorial_candidate', p_candidate_id::text);
end $$;

revoke all on function public.select_candidate(uuid) from public, anon, authenticated;
grant execute on function public.select_candidate(uuid) to authenticated;
