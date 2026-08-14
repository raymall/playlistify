-- Fix `column reference "song_id" is ambiguous` in claim_song_enrichment_job.
--
-- The RETURNS TABLE list declares an OUT parameter named `song_id`, which is in
-- scope for the whole body, so the unqualified `song_id = p_song_id` in the
-- ownership check matched both it and user_songs.song_id. Every other reference
-- in the function was already table-qualified; this one was not. Aliasing the
-- table makes the reference unambiguous without changing behaviour.

create or replace function public.claim_song_enrichment_job(
  p_user_id uuid,
  p_song_id uuid,
  p_lease_seconds integer,
  p_lease_token uuid
)
returns table (
  job_id uuid,
  lease_token uuid,
  song_id uuid,
  recipe_id uuid,
  expected_revision bigint,
  spotify_track_id text,
  title text,
  artists text[],
  album text,
  release_date date,
  provider text,
  model_id text,
  recipe_rank smallint,
  prompt_version text,
  vocabulary_version text,
  identity_version text
)
language plpgsql
set search_path = ''
as $$
declare
  claimed_id uuid;
  lease_seconds integer := least(900, greatest(60, p_lease_seconds));
begin
  if p_lease_token is null then
    raise exception 'lease token is required';
  end if;

  if not exists (
    select 1
    from public.user_songs us
    where us.user_id = p_user_id and us.song_id = p_song_id
  ) then
    raise exception 'song is not in caller library';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_lease_token::text, 0)
  );

  select j.id
  into claimed_id
  from public.song_enrichment_jobs j
  where j.song_id = p_song_id
    and j.status = 'leased'
    and j.lease_token = p_lease_token
    and j.lease_expires_at > now()
  limit 1;

  if claimed_id is null then
    update public.song_enrichment_jobs j
    set
      status = 'queued',
      lease_token = null,
      lease_expires_at = null,
      expected_revision = null,
      updated_at = now()
    where j.song_id = p_song_id
      and j.status = 'leased'
      and j.lease_expires_at <= now();

    -- A song can hold one job per recipe; take the most urgent, then the
    -- strongest, mirroring how the batch claim orders within a recipe.
    select j.id
    into claimed_id
    from public.song_enrichment_jobs j
    join public.enrichment_recipes er on er.id = j.recipe_id and er.enabled
    where j.song_id = p_song_id
      and j.status = 'queued'
      and j.next_attempt_at <= now()
    order by j.priority desc, er.enrichment_rank desc, j.id
    for update of j skip locked
    limit 1;

    if claimed_id is null then
      return;
    end if;

    update public.song_enrichment_jobs j
    set
      status = 'leased',
      lease_token = p_lease_token,
      lease_expires_at = now() + make_interval(secs => lease_seconds),
      expected_revision = s.enrichment_revision,
      updated_at = now()
    from public.songs s
    where j.id = claimed_id
      and s.id = j.song_id;
  end if;

  return query
  select
    j.id,
    j.lease_token,
    s.id,
    er.id,
    j.expected_revision,
    s.spotify_track_id,
    s.title,
    s.artists,
    s.album,
    s.release_date,
    m.provider,
    m.model_id,
    er.enrichment_rank,
    er.prompt_version,
    er.vocabulary_version,
    er.identity_version
  from public.song_enrichment_jobs j
  join public.songs s on s.id = j.song_id
  join public.enrichment_recipes er on er.id = j.recipe_id
  join public.llm_models m on m.id = er.model_id
  where j.id = claimed_id;
end;
$$;
