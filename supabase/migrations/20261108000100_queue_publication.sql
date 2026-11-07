-- Puts the rendered video of an approved version in the publication queue.
-- Always private: going public stays a separate admin act (authorize_public_publication)
-- on top of a reviewed change to distribution.yml. Title, description and tags come
-- from the metadata stored with the version, built from the cited sources at compose
-- time, so the Studio sends no text of its own.
create or replace function public.queue_publication(p_version_id uuid)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_queue_id uuid;
  v_asset_id uuid;
  v_meta jsonb;
  v_title text;
  v_tags text[];
begin
  perform private.require_staff();
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

revoke all on function public.queue_publication(uuid) from public, anon, authenticated;
grant execute on function public.queue_publication(uuid) to authenticated;
