-- Widen the approved mood vocabulary, then cut a vocabulary-v2 recipe
-- generation to carry it.
--
-- Why: matchApprovedVocabulary (lib/vocabulary.ts) searches one kind only, so a
-- word approved as a genre is dropped when the model returns it as a mood, and
-- five common mood words had no approved row at all. unmatched_tags recorded
-- 212 drops across 49 names; the 27 below cover 166 of them. Two classes:
--   * kind collisions — already approved genres, now also approved as moods
--     (melancholic alone accounts for 57 drops). Precedent: 13 names such as
--     dark, romantic and smooth are already approved as both.
--   * genuine gaps — sensual (43), party (24), seductive (15), bold, joyful,
--     plus the long tail the model keeps reaching for.
--
-- The matcher is deliberately NOT changed to cross-search kinds: that would let
-- reggaeton be accepted as a mood. Dual approval is data, and stays data.

insert into public.moods (name, is_approved) values
  ('assertive', true),
  ('bold', true),
  ('celebratory', true),
  ('charismatic', true),
  ('chill', true),
  ('dance', true),
  ('energizing', true),
  ('fiery', true),
  ('hard', true),
  ('joyful', true),
  ('luxurious', true),
  ('melancholic', true),
  ('melodic', true),
  ('menacing', true),
  ('party', true),
  ('psychedelic', true),
  ('rowdy', true),
  ('seductive', true),
  ('sensual', true),
  ('somber', true),
  ('soothing', true),
  ('spiritual', true),
  ('sunny', true),
  ('tense', true),
  ('theatrical', true),
  ('thoughtful', true),
  ('urban', true)
on conflict (name) do update set is_approved = true;

-- Recipe identity is immutable (ARCHITECTURE.md § Constraints and invariants),
-- so a wider vocabulary gets a new generation rather than an in-place version
-- bump — song_enrichment_attempts stores only recipe_id, and mutating the row
-- would retroactively relabel every past attempt as having run against this
-- list. Ranks are carried over unchanged (100/200/300), so no song's
-- eligibility moves and highest_attempted_recipe_rank keeps its meaning.
--
-- retire_disabled_enrichment_jobs only retires *queued* work, and there is
-- none; the four completed jobs stay completed against their retired recipe.

update public.enrichment_recipes
set enabled = false, is_default = false
where vocabulary_version = 'vocabulary-v1';

-- enabled/is_default come from llm_models because the statement above has
-- already cleared them on the row being replaced. That catalog is where both
-- flags are curated, and it matches the recipes it seeded.
insert into public.enrichment_recipes (
  model_id,
  recipe_key,
  label,
  prompt_version,
  vocabulary_version,
  identity_version,
  enrichment_rank,
  enabled,
  is_default
)
select
  prev.model_id,
  m.provider || ':' || m.model_id || ':prompt-v1:vocabulary-v2:identity-v1',
  m.label || ' · vocabulary-v2',
  prev.prompt_version,
  'vocabulary-v2',
  prev.identity_version,
  prev.enrichment_rank,
  m.enabled,
  m.is_default
from public.enrichment_recipes prev
join public.llm_models m on m.id = prev.model_id
where prev.vocabulary_version = 'vocabulary-v1';
