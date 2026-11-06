-- Private bucket: files are read through short-lived signed URLs only.
-- 50 MB matches the per-file ceiling of the Supabase free plan.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', false, 52428800, array['audio/mpeg', 'video/mp4', 'image/png', 'image/jpeg', 'text/vtt', 'application/x-subrip']);

create policy staff_read_media on storage.objects for select to authenticated
  using (bucket_id = 'media' and (select private.is_staff()));
