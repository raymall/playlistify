-- Model rank: the mechanism that makes global enrichment one-way. A song is
-- only ever re-enriched by a model that strictly outranks the one recorded on
-- it, so the shared cache can improve but never degrade.

alter table public.llm_models
  add column enrichment_rank smallint not null default 0;

comment on column public.llm_models.enrichment_rank is
  'Capability ordering for music-metadata recall specifically — not a general model quality score, and unrelated to sort_order (dropdown position). Sparse values so a new model slots in without renumbering; genuinely incomparable models share a rank, and the strict > guard makes ties refuse.';

-- not null default 0 on purpose: 0 means "never enriched / rank unknown",
-- every real model rank is > 0, so the selector filter stays a plain <
-- with no null branch.
alter table public.songs
  add column enrichment_rank smallint not null default 0;

comment on column public.songs.enrichment_rank is
  'Snapshot of llm_models.enrichment_rank taken when this row was written, beside enrichment_model. A snapshot rather than a lookup: enrichment_model is a plain text string with no FK, and catalog rows are operational data that can be deleted, renamed, or re-ranked in Studio. 0 = never enriched.';

-- One-time bootstrap of the seeded catalog rows. Guarded by (provider,
-- model_id) so it no-ops on a row that was removed in Studio; from here on
-- rank is Studio-owned operational data, not schema.
update public.llm_models set enrichment_rank = 100
  where provider = 'openai' and model_id = 'gpt-5.4-nano';
update public.llm_models set enrichment_rank = 200
  where provider = 'openai' and model_id = 'gpt-5.4-mini';
update public.llm_models set enrichment_rank = 300
  where provider = 'openai' and model_id = 'gpt-5.4';

-- One-time backfill of already-enriched songs from the catalog.
-- enrichment_model holds the 'provider:model_id' string.
update public.songs s
set enrichment_rank = m.enrichment_rank
from public.llm_models m
where s.enrichment_model = m.provider || ':' || m.model_id;

-- Serves the re-enrichment selector: eligible rows are filtered by status and
-- then by rank below the selected model's.
create index songs_enrichment_rank_idx
  on public.songs (enrichment_status, enrichment_rank);
