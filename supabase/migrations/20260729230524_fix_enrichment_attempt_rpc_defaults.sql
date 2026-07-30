-- Supabase's type generator does not represent nullable PostgreSQL function
-- arguments as nullable TypeScript values. This wrapper uses an optional text
-- confidence at the JSON boundary, then delegates to the typed numeric
-- attempt recorder. Omitted/failed outcomes can therefore pass SQL NULL
-- without an unsafe client-side cast.

create function public.record_song_enrichment_outcome(
  p_job_id uuid,
  p_lease_token uuid,
  p_outcome text,
  p_confidence_text text default null,
  p_ai_attributes jsonb default null,
  p_genre_names text[] default '{}',
  p_mood_names text[] default '{}'
)
returns uuid
language sql
set search_path = ''
as $$
  select public.record_song_enrichment_attempt(
    p_job_id,
    p_lease_token,
    p_outcome,
    nullif(p_confidence_text, '')::numeric,
    p_ai_attributes,
    p_genre_names,
    p_mood_names
  );
$$;

revoke execute on function
  public.record_song_enrichment_outcome(
    uuid,
    uuid,
    text,
    text,
    jsonb,
    text[],
    text[]
  )
  from public, anon, authenticated;

grant execute on function
  public.record_song_enrichment_outcome(
    uuid,
    uuid,
    text,
    text,
    jsonb,
    text[],
    text[]
  )
  to service_role;
