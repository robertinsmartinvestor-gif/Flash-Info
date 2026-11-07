-- The voice chosen with the listening test. Admins change it from the Studio.
insert into public.app_settings (key, value) values
  ('tts_voice', '{"provider": "google", "voice": "it-IT-Chirp3-HD-Charon"}');

create or replace function public.set_tts_voice(p_provider text, p_voice text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_from jsonb := (select value from public.app_settings where key = 'tts_voice');
  v_to jsonb := jsonb_build_object('provider', p_provider, 'voice', p_voice);
begin
  if not private.is_admin() then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  if (p_provider, p_voice) not in (
    ('google', 'it-IT-Chirp3-HD-Charon'),
    ('google', 'it-IT-Chirp3-HD-Kore'),
    ('azure', 'it-IT-Alessio:DragonHDLatestNeural'),
    ('azure', 'it-IT-Isabella:DragonHDLatestNeural')
  ) then
    raise exception 'voice not allowed' using errcode = '22023';
  end if;
  insert into public.app_settings (key, value) values ('tts_voice', v_to)
    on conflict (key) do update set value = excluded.value, updated_at = now();
  perform private.write_audit('settings.tts_voice_changed', 'app_settings', 'tts_voice', jsonb_build_object('from', v_from, 'to', v_to));
end $$;

revoke all on function public.set_tts_voice(text, text) from public, anon, authenticated;
grant execute on function public.set_tts_voice(text, text) to authenticated;
