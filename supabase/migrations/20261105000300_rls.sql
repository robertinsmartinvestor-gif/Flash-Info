-- Default deny: anon gets nothing, staff read through RLS, writes go through
-- the functions above. The service role bypasses RLS and stays on trusted jobs.

do $$
declare
  t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
    execute format('revoke all on public.%I from anon, authenticated', t.tablename);
    if t.tablename <> 'admin_users' then
      execute format('grant select on public.%I to authenticated', t.tablename);
      execute format(
        'create policy staff_read on public.%I for select to authenticated using ((select private.is_staff()))',
        t.tablename
      );
    end if;
  end loop;
end $$;

grant select on public.admin_users to authenticated;
create policy own_row on public.admin_users for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.pipeline_overview from anon;
grant select on public.pipeline_overview to authenticated;

revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;
revoke all on all functions in schema private from public, anon;
grant execute on function private.is_staff() to authenticated, service_role;

revoke all on all functions in schema public from public, anon, authenticated;

grant execute on function public.approve_script_version(uuid, text) to authenticated;
grant execute on function public.reject_script(uuid, text) to authenticated;
grant execute on function public.enqueue_production_job(uuid, text) to authenticated;
grant execute on function public.authorize_public_publication(uuid) to authenticated;
grant execute on function public.provider_spend_usd(timestamptz) to authenticated, service_role;

grant execute on function public.claim_job(uuid, text) to service_role;
grant execute on function public.finish_job(uuid, text, jsonb, text, text) to service_role;
grant execute on function public.requeue_stale_jobs(integer) to service_role;
grant execute on function public.register_youtube_upload(uuid, text, text) to service_role;
