-- Custom cover for every new Short.
--
-- The render job stores a PNG cover next to the video (media_assets.kind =
-- 'thumbnail'), and a version enters the publication queue only when both exist.
-- The upload then runs in two recorded stages, so no error can cause a second
-- videos.insert:
--   uploading  -> videos.insert, always private; the returned id is recorded at once
--   processing -> on YouTube, private, waiting for processing, cover and visibility
--   finalizing -> a runner holds it: thumbnails.set, then the final visibility
--   uploaded   -> cover confirmed by the API and final visibility applied
-- Rows queued before this migration have no cover and keep the old single-step path.

alter table public.publication_queue
  add column thumbnail_asset_id uuid references public.media_assets (id) on delete restrict,
  add column thumbnail_status text check (thumbnail_status in ('pending', 'set', 'failed')),
  add column thumbnail_attempts integer not null default 0,
  add column thumbnail_error text,
  add column thumbnail_set_at timestamptz,
  add column finalize_started_at timestamptz;

alter table public.publication_queue drop constraint publication_queue_status_check;
alter table public.publication_queue add constraint publication_queue_status_check
  check (status in ('pending', 'scheduled', 'uploading', 'processing', 'finalizing', 'uploaded', 'failed', 'cancelled'));

-- A cover counts as confirmed only with its time.
alter table public.publication_queue add constraint thumbnail_set_has_time
  check (thumbnail_status is distinct from 'set' or thumbnail_set_at is not null);

create index publication_queue_finalize_idx on public.publication_queue (status) where status in ('processing', 'finalizing');

-- How many failed thumbnails.set calls before a person has to look.
create or replace function private.max_thumbnail_attempts() returns integer
language sql immutable as $$ select 5 $$;

-- The body of queue_publication, now with the cover: no cover, no queue item.
create or replace function private.queue_item(p_version_id uuid)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_queue_id uuid;
  v_asset_id uuid;
  v_thumbnail_id uuid;
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
  select id into v_thumbnail_id from public.media_assets
    where script_version_id = p_version_id and kind = 'thumbnail' and mime_type = 'image/png' and deleted_at is null
    order by created_at desc limit 1;
  if v_thumbnail_id is null then
    raise exception 'no cover for this version' using errcode = 'P0001';
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

  insert into public.publication_queue (
    script_version_id, video_asset_id, thumbnail_asset_id, thumbnail_status, privacy, contains_synthetic_media, title, description, tags
  )
  values (
    p_version_id, v_asset_id, v_thumbnail_id, 'pending', 'private', true, v_title,
    left(translate(coalesce(v_meta ->> 'description', ''), '<>', ''), 5000), v_tags
  )
  returning id into v_queue_id;
  perform private.write_audit('publication.queued', 'publication_queue', v_queue_id::text, jsonb_build_object('version_id', p_version_id));
  return v_queue_id;
end $$;

-- As before, plus the path of the cover.
create or replace function public.begin_upload(p_queue_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.publication_queue;
  v_approved boolean;
  v_path text;
  v_thumbnail_path text;
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
  select storage_path into v_thumbnail_path from public.media_assets
    where id = v_row.thumbnail_asset_id and deleted_at is null;
  return to_jsonb(v_row) || jsonb_build_object('storage_path', v_path, 'thumbnail_path', v_thumbnail_path, 'script_approved', v_approved);
end $$;

-- Called right after videos.insert returns. From here the item can never be
-- uploaded again: begin_upload refuses any row with a youtube_publications entry.
create or replace function public.record_youtube_video(p_queue_id uuid, p_video_id text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.publication_queue
    set status = 'processing', last_error = null
    where id = p_queue_id and status = 'uploading' and thumbnail_asset_id is not null;
  if not found then
    raise exception 'queue item is not uploading with a cover' using errcode = 'P0001';
  end if;
  -- Private until the cover is confirmed; complete_publication writes the final value.
  insert into public.youtube_publications (queue_id, youtube_video_id, privacy) values (p_queue_id, p_video_id, 'private');
  perform private.write_audit('publication.video_inserted', 'publication_queue', p_queue_id::text, jsonb_build_object('video_id', p_video_id));
end $$;

-- Takes an item that is on YouTube and still needs its cover or its visibility.
-- One runner at a time; a runner that died releases the item after 30 minutes.
create or replace function public.claim_finalize(p_queue_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.publication_queue;
  v_approved boolean;
  v_video text;
  v_thumbnail_path text;
begin
  update public.publication_queue
    set status = 'finalizing', finalize_started_at = now()
    where id = p_queue_id
      and (status = 'processing' or (status = 'finalizing' and finalize_started_at < now() - interval '30 minutes'))
      and thumbnail_attempts < private.max_thumbnail_attempts()
    returning * into v_row;
  if not found then
    return null;
  end if;

  select exists (
    select 1 from public.scripts s where s.approved_version_id = v_row.script_version_id and s.status = 'approved'
  ) into v_approved;
  select youtube_video_id into v_video from public.youtube_publications where queue_id = p_queue_id;
  select storage_path into v_thumbnail_path from public.media_assets
    where id = v_row.thumbnail_asset_id and deleted_at is null;
  return to_jsonb(v_row) || jsonb_build_object('youtube_video_id', v_video, 'thumbnail_path', v_thumbnail_path, 'script_approved', v_approved);
end $$;

-- Gives the item back without counting a cover failure: YouTube still processing,
-- or the visibility update failed after a confirmed cover.
create or replace function public.release_finalize(p_queue_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.publication_queue
    set status = 'processing', last_error = left(p_reason, 300), finalize_started_at = null
    where id = p_queue_id and status = 'finalizing';
end $$;

-- thumbnails.set failed: counted, recorded apart from upload errors, retried later.
create or replace function public.fail_thumbnail(p_queue_id uuid, p_error text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.publication_queue
    set status = 'processing', thumbnail_status = 'failed', thumbnail_attempts = thumbnail_attempts + 1,
        thumbnail_error = left(p_error, 300), finalize_started_at = null
    where id = p_queue_id and status = 'finalizing';
  if found then
    perform private.write_audit('publication.thumbnail_failed', 'publication_queue', p_queue_id::text, jsonb_build_object('error', left(p_error, 120)));
  end if;
end $$;

-- Only after thumbnails.set answered with the new cover.
create or replace function public.confirm_thumbnail(p_queue_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.publication_queue
    set thumbnail_status = 'set', thumbnail_set_at = now(), thumbnail_error = null
    where id = p_queue_id and status = 'finalizing';
  if not found then
    raise exception 'queue item is not being finalized' using errcode = 'P0001';
  end if;
  perform private.write_audit('publication.thumbnail_set', 'publication_queue', p_queue_id::text);
end $$;

-- The end: cover confirmed and final visibility applied on YouTube.
create or replace function public.complete_publication(p_queue_id uuid, p_privacy text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_privacy not in ('private', 'unlisted', 'public') then
    raise exception 'invalid privacy' using errcode = '22023';
  end if;
  update public.publication_queue
    set status = 'uploaded', last_error = null, finalize_started_at = null
    where id = p_queue_id and status = 'finalizing' and thumbnail_status = 'set';
  if not found then
    raise exception 'cover not confirmed' using errcode = 'P0001';
  end if;
  update public.youtube_publications set privacy = p_privacy where queue_id = p_queue_id;
  perform private.write_audit('publication.completed', 'publication_queue', p_queue_id::text, jsonb_build_object('privacy', p_privacy));
end $$;

-- Covers, like videos, survive their expiry date until the upload is over.
create or replace function public.expired_media_assets(p_limit integer default 100)
returns table (id uuid, storage_bucket text, storage_path text)
language sql stable security definer set search_path = '' as $$
  select a.id, a.storage_bucket, a.storage_path
  from public.media_assets a
  where a.deleted_at is null and a.expires_at < now()
    and not exists (
      select 1 from public.publication_queue q
      where (q.video_asset_id = a.id or q.thumbnail_asset_id = a.id)
        and q.status in ('pending', 'scheduled', 'uploading', 'processing', 'finalizing')
    )
  order by a.expires_at
  limit p_limit;
$$;

revoke all on function private.max_thumbnail_attempts() from public, anon, authenticated;
revoke all on function public.record_youtube_video(uuid, text) from public, anon, authenticated;
revoke all on function public.claim_finalize(uuid) from public, anon, authenticated;
revoke all on function public.release_finalize(uuid, text) from public, anon, authenticated;
revoke all on function public.fail_thumbnail(uuid, text) from public, anon, authenticated;
revoke all on function public.confirm_thumbnail(uuid) from public, anon, authenticated;
revoke all on function public.complete_publication(uuid, text) from public, anon, authenticated;
grant execute on function public.record_youtube_video(uuid, text) to service_role;
grant execute on function public.claim_finalize(uuid) to service_role;
grant execute on function public.release_finalize(uuid, text) to service_role;
grant execute on function public.fail_thumbnail(uuid, text) to service_role;
grant execute on function public.confirm_thumbnail(uuid) to service_role;
grant execute on function public.complete_publication(uuid, text) to service_role;
