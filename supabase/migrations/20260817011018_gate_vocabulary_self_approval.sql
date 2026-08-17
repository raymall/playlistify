-- Close the one hole in "enrichment is approved-only": authenticated INSERT on
-- the shared vocabulary was `with check (true)`, so a client could write a row
-- with is_approved = true and inject its own name into the vocabulary the
-- enrichment prompt is built from — reaching every user's shared analysis.
--
-- Personal tagging is unaffected: it is free-form by design and only ever
-- inserts `{ name }`, taking the column default of false. Approval stays a
-- deliberate, migration-authored act (see 20260723213019_seed_approved_vocabulary
-- and 20260814003544_widen_mood_vocabulary), which the service role performs
-- outside RLS.
--
-- `not is_approved` rather than `is_approved = false` so a NULL can never slip
-- through; the column is `not null default false`, so this only ever rejects an
-- explicit true.

drop policy "genres_insert_authenticated" on public.genres;

create policy "genres_insert_authenticated"
  on public.genres for insert
  to authenticated
  with check (not is_approved);

drop policy "moods_insert_authenticated" on public.moods;

create policy "moods_insert_authenticated"
  on public.moods for insert
  to authenticated
  with check (not is_approved);
