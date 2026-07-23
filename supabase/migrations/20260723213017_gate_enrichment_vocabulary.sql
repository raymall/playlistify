-- Gate the enrichment vocabulary: genres/moods gain an approved flag, the
-- enrichment engine only links approved rows, and LLM tags that match no
-- approved row land in unmatched_tags for review instead of growing the
-- vocabulary. Personal tags (user_genres/user_moods) stay open.

alter table public.genres
  add column is_approved boolean not null default false;

alter table public.moods
  add column is_approved boolean not null default false;

-- Enrichment loads only the approved slice on every batch.
create index genres_is_approved_idx
  on public.genres (is_approved)
  where is_approved;

create index moods_is_approved_idx
  on public.moods (is_approved)
  where is_approved;

-- Review log for enrichment tags that matched no approved row. name is
-- normalized by the app (lib/vocabulary.ts normalizeTagName) before logging.
create table public.unmatched_tags (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('genre', 'mood')),
  name text not null,
  occurrences integer not null default 1,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  unique (kind, name)
);

alter table public.unmatched_tags enable row level security;

-- Reviewable by any signed-in user; writes only via the service role
-- (log_unmatched_tags below) — same posture as song_genres/song_moods.
create policy "unmatched_tags_select_authenticated"
  on public.unmatched_tags for select
  to authenticated
  using (true);

-- Upsert-with-increment that supabase-js cannot express in one call.
-- Security invoker: with no insert/update policies above, only the service
-- role can actually write through it.
create function public.log_unmatched_tags(p_kind text, p_names text[])
returns void
language sql
set search_path = ''
as $$
  insert into public.unmatched_tags (kind, name)
  select distinct p_kind, t.name
  from unnest(p_names) as t(name)
  on conflict (kind, name) do update
    set occurrences = unmatched_tags.occurrences + 1,
        last_seen = now();
$$;

revoke execute on function public.log_unmatched_tags(text, text[])
  from public, anon, authenticated;

grant execute on function public.log_unmatched_tags(text, text[])
  to service_role;
