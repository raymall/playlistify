-- One sanctioned way to delete enrichment history, because there has to be
-- exactly one and there was none.
--
-- song_enrichment_attempts is append-only by trigger, which is correct: the
-- attempts log is what the three-answers-per-rank budget is derived from, and
-- a writer that could erase it could hand a song unlimited analyses. But
-- reset:enrichment has to clear it — a song put back to 'pending' on top of a
-- spent budget is locked the moment it is reset — and until now the script
-- would simply abort against the trigger partway through.
--
-- The choice is between "no way to purge" (reset is broken) and "the trigger
-- is advisory" (the budget is unenforceable). This is the third option: the
-- trigger still refuses every ordinary DELETE, including from the engine,
-- and yields only inside this function.
--
-- A transaction-local GUC rather than `alter table ... disable trigger`:
-- set_config(..., true) cannot outlive its transaction, so there is no state
-- to leak if this fails halfway, and it takes no ACCESS EXCLUSIVE lock on a
-- table the engine is probably writing to.

create or replace function public.enforce_song_enrichment_attempt_immutability()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- Yields only to purge_song_enrichment_history() below, which sets this
    -- for the duration of its own transaction and nothing else.
    if coalesce(
         current_setting('app.purge_enrichment_history', true), ''
       ) <> 'on' then
      raise exception 'song enrichment attempts are append-only';
    end if;
    return old;
  end if;

  if old.decision <> 'pending'
     or new.decision not in ('promoted', 'rejected')
     or new.decision_reason is null
     or new.decided_at is null
     or (
       to_jsonb(new) - array['decision', 'decision_reason', 'decided_at']
       <>
       to_jsonb(old) - array['decision', 'decision_reason', 'decided_at']
     ) then
    raise exception 'song enrichment attempt is immutable';
  end if;

  return new;
end;
$$;

-- Clears the queue history for a set of songs: the two foreign keys into the
-- attempts log first (both ON DELETE RESTRICT), then the attempts, then the
-- jobs. Jobs go too because a job left `failed` excludes its recipe forever,
-- which would lock the song just as surely as a spent budget.
--
-- It deliberately does NOT touch songs.enrichment_status, ai_confidence, or
-- the tag links. Purging history and resetting a canonical result are separate
-- decisions, and reset:enrichment is the caller that makes both.
create function public.purge_song_enrichment_history(p_song_ids uuid[])
returns table (attempts_deleted integer, jobs_deleted integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed_attempts integer;
  removed_jobs integer;
begin
  if p_song_ids is null or cardinality(p_song_ids) = 0 then
    return query select 0, 0;
    return;
  end if;

  update public.songs
  set active_enrichment_attempt_id = null,
      highest_attempted_recipe_id = null
  where id = any(p_song_ids);

  update public.song_enrichment_jobs
  set result_attempt_id = null
  where song_id = any(p_song_ids);

  perform set_config('app.purge_enrichment_history', 'on', true);

  delete from public.song_enrichment_attempts where song_id = any(p_song_ids);
  get diagnostics removed_attempts = row_count;

  delete from public.song_enrichment_jobs where song_id = any(p_song_ids);
  get diagnostics removed_jobs = row_count;

  perform set_config('app.purge_enrichment_history', 'off', true);

  return query select removed_attempts, removed_jobs;
end;
$$;

revoke execute on function public.purge_song_enrichment_history(uuid[])
  from public, anon, authenticated;

grant execute on function public.purge_song_enrichment_history(uuid[])
  to service_role;
