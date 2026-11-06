-- OgniOra editorial schema. All timestamps are timestamptz, stored in UTC.
-- This database is dedicated to OgniOra: nothing here is shared with Lepefy.

create schema if not exists private;

create or replace function private.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- Studio users. A row here is what turns an authenticated user into staff.
create table public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'editor' check (role in ('admin', 'editor')),
  created_at timestamptz not null default now()
);

-- Runtime settings readable from SQL (retention, job and budget limits).
create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

insert into public.app_settings (key, value) values
  ('retention_days', '{"articles": 90, "media_preview": 14, "provider_usage": 400, "audit_logs": 730}'),
  ('job_limits', '{"max_active": 3, "max_per_day": 12, "max_attempts": 3}'),
  ('budget', '{"monthly_usd": 20, "per_content_usd": 0.5}');

create table public.news_sources (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,64}$'),
  name text not null,
  publisher text not null,
  homepage_url text not null,
  feed_url text not null unique check (feed_url ~ '^https://'),
  kind text not null default 'rss' check (kind in ('rss', 'atom', 'api')),
  default_category text,
  territory text not null default 'IT',
  reliability numeric(3, 2) not null default 0.70 check (reliability between 0 and 1),
  group_key text not null,
  enabled boolean not null default true,
  etag text,
  last_modified text,
  last_fetched_at timestamptz,
  last_status text,
  consecutive_failures integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on column public.news_sources.group_key is
  'Editorial group: two outlets of one group do not count as independent confirmation.';

create table public.news_articles (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.news_sources (id) on delete restrict,
  url text not null,
  canonical_url text not null unique,
  title text not null,
  summary text not null default '',
  author text,
  publisher text not null,
  language text not null default 'it',
  published_at timestamptz,
  event_at timestamptz,
  fetched_at timestamptz not null default now(),
  content_hash text not null,
  category text,
  territory text,
  created_at timestamptz not null default now()
);
comment on column public.news_articles.published_at is 'When the outlet published the article.';
comment on column public.news_articles.event_at is 'When the reported fact happened, when known. Not the publication date.';
create index news_articles_published_idx on public.news_articles (published_at desc);
create index news_articles_source_idx on public.news_articles (source_id, published_at desc);
create index news_articles_hash_idx on public.news_articles (content_hash);

create table public.news_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  summary text not null default '',
  category text,
  territory text,
  status text not null default 'open' check (status in ('open', 'covered', 'archived')),
  update_of_event_id uuid references public.news_events (id) on delete set null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  event_at timestamptz,
  independent_sources integer not null default 0,
  score numeric(5, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index news_events_status_idx on public.news_events (status, last_seen_at desc);

-- One article belongs to one event: the unique key keeps clustering idempotent.
create table public.news_event_sources (
  event_id uuid not null references public.news_events (id) on delete cascade,
  article_id uuid not null unique references public.news_articles (id) on delete cascade,
  similarity numeric(4, 3) not null default 1,
  added_at timestamptz not null default now(),
  primary key (event_id, article_id)
);

create table public.editorial_candidates (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.news_events (id) on delete cascade,
  format text not null check (format in ('flash', 'briefing', 'spiega')),
  status text not null default 'proposed'
    check (status in ('proposed', 'selected', 'rejected', 'scripted', 'expired')),
  score numeric(5, 2) not null,
  score_breakdown jsonb not null default '{}',
  is_update boolean not null default false,
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, format)
);
create index editorial_candidates_status_idx on public.editorial_candidates (status, score desc);

create table public.scripts (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null unique references public.editorial_candidates (id) on delete restrict,
  format text not null check (format in ('flash', 'briefing', 'spiega')),
  status text not null default 'draft'
    check (status in ('draft', 'in_review', 'blocked', 'approved', 'rejected')),
  current_version integer not null default 0,
  approved_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Each generation or edit adds a row: content is immutable once written.
create table public.script_versions (
  id uuid primary key default gen_random_uuid(),
  script_id uuid not null references public.scripts (id) on delete cascade,
  version integer not null check (version > 0),
  content jsonb not null,
  narration text not null,
  word_count integer not null,
  estimated_seconds numeric(6, 1) not null,
  youtube_metadata jsonb not null default '{}',
  evidence jsonb not null default '[]',
  qc_verdict text not null check (qc_verdict in ('pass', 'needs_review', 'blocked')),
  qc_report jsonb not null default '{}',
  provider text,
  model text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (script_id, version)
);

alter table public.scripts
  add constraint scripts_approved_version_fk
  foreign key (approved_version_id) references public.script_versions (id) on delete set null;

create table public.production_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('tts', 'render', 'distribution')),
  script_version_id uuid not null references public.script_versions (id) on delete restrict,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  idempotency_key text not null unique,
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  runner_id text,
  heartbeat_at timestamptz,
  error_code text,
  error_message text,
  result jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create index production_jobs_queue_idx on public.production_jobs (status, created_at);

create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  script_version_id uuid not null references public.script_versions (id) on delete restrict,
  job_id uuid references public.production_jobs (id) on delete set null,
  kind text not null check (kind in ('audio', 'video', 'subtitles', 'thumbnail', 'preview', 'image')),
  storage_bucket text not null default 'media',
  storage_path text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  sha256 text,
  duration_seconds numeric(8, 2),
  rights jsonb not null default '{}',
  expires_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (storage_bucket, storage_path)
);
comment on column public.media_assets.rights is 'Licence and origin. Third-party images need it filled in before use.';
create index media_assets_expiry_idx on public.media_assets (expires_at) where deleted_at is null;

create table public.publication_queue (
  id uuid primary key default gen_random_uuid(),
  script_version_id uuid not null unique references public.script_versions (id) on delete restrict,
  video_asset_id uuid not null references public.media_assets (id) on delete restrict,
  status text not null default 'pending'
    check (status in ('pending', 'scheduled', 'uploading', 'uploaded', 'failed', 'cancelled')),
  privacy text not null default 'private' check (privacy in ('private', 'unlisted', 'public')),
  publish_at timestamptz,
  contains_synthetic_media boolean not null default true,
  title text not null check (char_length(title) <= 100),
  description text not null check (char_length(description) <= 5000),
  tags text[] not null default '{}',
  public_authorized_by uuid references auth.users (id) on delete set null,
  public_authorized_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Second barrier behind decideUpload(): no public row without a named approver.
  constraint public_requires_authorization check (
    privacy <> 'public' or (public_authorized_by is not null and public_authorized_at is not null)
  )
);
create index publication_queue_status_idx on public.publication_queue (status, publish_at);

create table public.youtube_publications (
  id uuid primary key default gen_random_uuid(),
  queue_id uuid not null unique references public.publication_queue (id) on delete restrict,
  youtube_video_id text not null unique,
  privacy text not null check (privacy in ('private', 'unlisted', 'public')),
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.video_analytics (
  youtube_video_id text not null,
  day date not null,
  views bigint,
  watch_minutes numeric(12, 2),
  average_view_seconds numeric(8, 2),
  likes bigint,
  comments bigint,
  subscribers_gained bigint,
  retention jsonb,
  synced_at timestamptz not null default now(),
  primary key (youtube_video_id, day)
);

create table public.provider_usage (
  id bigint generated always as identity primary key,
  provider text not null,
  feature text not null,
  model text,
  input_tokens integer,
  output_tokens integer,
  characters integer,
  estimated_cost_usd numeric(10, 6) not null default 0,
  latency_ms integer,
  success boolean not null,
  script_id uuid references public.scripts (id) on delete set null,
  created_at timestamptz not null default now()
);
create index provider_usage_month_idx on public.provider_usage (created_at desc);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_type text not null check (actor_type in ('user', 'system')),
  actor_id uuid,
  action text not null,
  entity_type text not null,
  entity_id text,
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id, created_at desc);

create trigger set_updated_at before update on public.news_sources for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.news_events for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.editorial_candidates for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.scripts for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.production_jobs for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.publication_queue for each row execute function private.set_updated_at();

create or replace function private.reject_change() returns trigger
language plpgsql as $$
begin
  raise exception '% on % is not allowed', tg_op, tg_table_name using errcode = 'P0001';
end $$;

create trigger audit_logs_append_only before update or delete on public.audit_logs
  for each row execute function private.reject_change();
create trigger script_versions_immutable before update on public.script_versions
  for each row execute function private.reject_change();

create or replace function private.write_audit(
  p_action text, p_entity_type text, p_entity_id text, p_data jsonb default '{}'
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
begin
  insert into public.audit_logs (actor_type, actor_id, action, entity_type, entity_id, data)
  values (case when v_actor is null then 'system' else 'user' end, v_actor, p_action, p_entity_type, p_entity_id, p_data);
end $$;

-- Publication state history lives in audit_logs, written whatever the caller.
create or replace function private.log_publication_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status or new.privacy is distinct from old.privacy then
    perform private.write_audit(
      'publication.state', 'publication_queue', new.id::text,
      jsonb_build_object(
        'from', case when tg_op = 'UPDATE' then old.status end,
        'to', new.status,
        'privacy', new.privacy
      )
    );
  end if;
  return new;
end $$;

create trigger publication_state_history after insert or update on public.publication_queue
  for each row execute function private.log_publication_change();

create or replace function private.guard_youtube_publication() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_queue public.publication_queue;
begin
  select * into v_queue from public.publication_queue where id = new.queue_id;
  if new.privacy = 'public' and v_queue.public_authorized_at is null then
    raise exception 'public upload without authorization' using errcode = 'P0001';
  end if;
  if new.privacy <> v_queue.privacy then
    raise exception 'uploaded privacy differs from the queue' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger youtube_publication_guard before insert or update on public.youtube_publications
  for each row execute function private.guard_youtube_publication();
