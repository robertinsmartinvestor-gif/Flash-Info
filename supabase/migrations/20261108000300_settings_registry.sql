-- Settings the Studio can edit, described as data. Each row is one field of an
-- app_settings value: its type, bounds, and the label shown to the editor. The
-- Studio draws its form from this table and update_setting() checks every write
-- against it, so a new setting needs one row here and no new code.

create table public.setting_fields (
  key text not null,
  field text not null,
  kind text not null check (kind in ('boolean', 'integer', 'number', 'choices')),
  min_value numeric,
  max_value numeric,
  options text[],
  section text not null,
  label text not null,
  help text,
  position integer not null default 0,
  primary key (key, field),
  check (kind <> 'choices' or cardinality(options) > 0)
);

alter table public.setting_fields enable row level security;
revoke all on public.setting_fields from anon, authenticated;
grant select on public.setting_fields to authenticated;
create policy staff_read on public.setting_fields for select to authenticated using ((select private.is_staff()));

insert into public.setting_fields (key, field, kind, min_value, max_value, options, section, label, help, position) values
  ('autopilot', 'enabled', 'boolean', null, null, null, 'Pilota automatico', 'Pilota automatico attivo',
   'Spento, nessun giro sceglie notizie, produce o pubblica.', 10),
  ('autopilot', 'max_stories_per_day', 'integer', 0, 12, null, 'Pilota automatico', 'Notizie al giorno',
   'Nuove notizie scritte in 24 ore. Ogni notizia costa circa 0,10 USD e un upload consuma 1.600 delle 10.000 unità YouTube giornaliere.', 20),
  ('autopilot', 'min_gap_hours', 'integer', 0, 24, null, 'Pilota automatico', 'Ore tra due notizie', null, 30),
  ('autopilot', 'candidate_max_age_hours', 'integer', 1, 48, null, 'Pilota automatico', 'Età massima di una notizia (ore)',
   'Il pilota sceglie solo candidati più recenti di così.', 40),
  ('autopilot', 'max_age_hours', 'integer', 1, 72, null, 'Pilota automatico', 'Età massima di uno script (ore)',
   'Oltre, uno script approvato non viene più prodotto né pubblicato.', 50),
  ('autopilot', 'hold_checks', 'choices', null, null,
   array['verifier', 'verifier_unavailable', 'verifier_incomplete', 'sensitive_topic', 'sensational_language', 'repetition', 'monotone_style', 'too_many_quotes', 'filler_sentence', 'duration'],
   'Pilota automatico', 'Rilievi che fermano la pubblicazione',
   'Uno script con uno di questi rilievi resta in Revisione. I blocchi fermano sempre.', 60),

  ('budget', 'monthly_usd', 'number', 0, 500, null, 'Spesa', 'Tetto mensile IA e voce (USD)',
   'Raggiunto il tetto, script e audio si fermano fino al mese successivo.', 10),


  ('job_limits', 'max_active', 'integer', 1, 10, null, 'Produzione', 'Job attivi insieme', null, 10),
  ('job_limits', 'max_per_day', 'integer', 1, 60, null, 'Produzione', 'Job al giorno', 'Audio e video contano come due job.', 20),
  ('job_limits', 'max_attempts', 'integer', 1, 5, null, 'Produzione', 'Tentativi per job', null, 30),

  ('retention_days', 'articles', 'integer', 7, 365, null, 'Conservazione', 'Articoli (giorni)', null, 10),
  ('retention_days', 'media_preview', 'integer', 1, 90, null, 'Conservazione', 'Audio e video (giorni)', null, 20),
  ('retention_days', 'provider_usage', 'integer', 30, 730, null, 'Conservazione', 'Registro dei costi (giorni)', null, 30),
  ('retention_days', 'audit_logs', 'integer', 90, 3650, null, 'Conservazione', 'Registro delle azioni (giorni)', null, 40);

-- The jobs read the monthly budget from here now. Until today the cap in force
-- was the AI_MONTHLY_BUDGET_USD variable, set to 5: keep that value.
update public.app_settings set value = jsonb_set(value, '{monthly_usd}', '5') where key = 'budget';

create or replace function public.update_setting(p_key text, p_field text, p_value jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_def public.setting_fields;
  v_from jsonb;
  v_number numeric;
  v_value jsonb := p_value;
  v_result jsonb;
begin
  if not private.is_admin() then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  select * into v_def from public.setting_fields where key = p_key and field = p_field;
  if not found then
    raise exception 'unknown setting' using errcode = '22023';
  end if;

  if v_def.kind = 'boolean' then
    if jsonb_typeof(p_value) <> 'boolean' then
      raise exception 'expected true or false' using errcode = '22023';
    end if;
  elsif v_def.kind in ('integer', 'number') then
    if jsonb_typeof(p_value) <> 'number' then
      raise exception 'expected a number' using errcode = '22023';
    end if;
    v_number := (p_value #>> '{}')::numeric;
    if v_def.kind = 'integer' and v_number <> trunc(v_number) then
      raise exception 'expected a whole number' using errcode = '22023';
    end if;
    if v_number < v_def.min_value or v_number > v_def.max_value then
      raise exception 'value out of range' using errcode = '22023';
    end if;
  else
    if jsonb_typeof(p_value) <> 'array' or exists (
      select 1 from jsonb_array_elements(p_value) e
      where jsonb_typeof(e) <> 'string' or not ((e #>> '{}') = any (v_def.options))
    ) then
      raise exception 'unknown option' using errcode = '22023';
    end if;
    v_value := coalesce((select jsonb_agg(distinct e) from jsonb_array_elements(p_value) e), '[]');
  end if;

  select value -> p_field into v_from from public.app_settings where key = p_key;
  insert into public.app_settings (key, value) values (p_key, jsonb_build_object(p_field, v_value))
    on conflict (key) do update set value = public.app_settings.value || jsonb_build_object(p_field, v_value), updated_at = now()
    returning value into v_result;
  perform private.write_audit('settings.changed', 'app_settings', p_key,
    jsonb_build_object('field', p_field, 'from', v_from, 'to', v_value));
  return v_result;
end $$;

revoke all on function public.update_setting(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.update_setting(text, text, jsonb) to authenticated;
