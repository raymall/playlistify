-- Remove the enrichment-history purge, reverting 20260816003822 in full.
--
-- That migration existed for one caller, scripts/reset-enrichment.mts, which
-- was deleted on 2026-08-16 once the approved-vocabulary cutover it performed
-- was done. Nothing calls the function now.
--
-- The trigger's GUC escape hatch goes with it, and that half is not optional.
-- Dropping the function alone would leave `song_enrichment_attempts_immutable`
-- yielding to any caller that sets `app.purge_enrichment_history` itself —
-- a bypass with no sanctioned door in front of it, which is strictly worse
-- than either the before or after state. RLS (enabled, zero policies) keeps
-- `authenticated` out regardless; the trigger is what constrains service-role
-- code, and that is exactly the code that could set the GUC.
--
-- So the attempts log returns to strictly append-only: no DELETE succeeds, from
-- anyone, for any reason. If a future reset tool needs to clear history, it
-- reintroduces a door deliberately rather than inheriting an open one.

drop function if exists public.purge_song_enrichment_history(uuid[]);

-- Restored verbatim from 20260729225628, minus the GUC branch.
create or replace function public.enforce_song_enrichment_attempt_immutability()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'song enrichment attempts are append-only';
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
