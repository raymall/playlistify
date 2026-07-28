-- Omission tracking: the model sometimes drops a song from a batch response.
-- There is no `failed` status by design, so those rows stay pending with no
-- write at all, and the batch selector is deterministic — without a brake they
-- are re-sent (and re-billed as prompt tokens) on every batch forever. These
-- two columns make giving up a database property instead of a client heuristic.

alter table public.songs
  add column enrichment_attempts smallint not null default 0;

comment on column public.songs.enrichment_attempts is
  'Consecutive times this song was sent in a batch and left out of the response. Reset to 0 by any successful write, and by giving up (see enrichment_skipped_rank).';

-- Deliberately not folded into enrichment_rank: that column means "the rank
-- that wrote this row" and pairs with enrichment_model, so 0 there means never
-- enriched. Giving up writes nothing, so it needs its own rank.
alter table public.songs
  add column enrichment_skipped_rank smallint not null default 0;

comment on column public.songs.enrichment_skipped_rank is
  'The llm_models.enrichment_rank that gave up on this song after repeated omissions. 0 = never given up. The selector skips a row whose value is >= the selected model rank, so a strictly stronger model still reaches it.';

-- Extends the existing selector index with the new skip filter, which both
-- selector passes now carry alongside status and rank.
drop index if exists public.songs_enrichment_rank_idx;
create index songs_enrichment_rank_idx
  on public.songs (enrichment_status, enrichment_rank, enrichment_skipped_rank);
