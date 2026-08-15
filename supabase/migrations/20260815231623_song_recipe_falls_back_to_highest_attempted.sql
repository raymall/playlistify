-- Name a recipe for songs analyzed before the attempts log existed.
--
-- active_enrichment_attempt_id is the exact answer — the attempt that actually
-- became the row's result — but it is only written by atomic promotion, which
-- arrived with guarded re-enrichment. Of 1876 songs, 5 have one and 1875 do
-- not, so sourcing the report from it alone leaves the Library showing no
-- recipe on essentially every row.
--
-- highest_attempted_recipe_id is set on those 1875. It is a slightly weaker
-- claim — the strongest recipe *tried*, not provably the one that won — but it
-- differs from the exact answer only for a song whose best attempt was
-- rejected, and a song with no active attempt at all has no such history. Kept
-- strictly as a fallback so the precise source always wins where it exists.

create or replace function public.library_song_recipes()
returns table (
  song_id uuid,
  recipe_id uuid,
  label text,
  is_current boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.id,
    er.id,
    er.label,
    er.enabled and er.is_default
  from public.user_songs us
  join public.songs s on s.id = us.song_id
  left join public.song_enrichment_attempts sea
    on sea.id = s.active_enrichment_attempt_id
  join public.enrichment_recipes er
    on er.id = coalesce(sea.recipe_id, s.highest_attempted_recipe_id)
  where us.user_id = (select auth.uid());
$$;
