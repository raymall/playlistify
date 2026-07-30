-- Lifecycle hardening discovered while integrating the queue worker.

-- Covers the jobs → attempts result foreign key in the reverse direction.
create index song_enrichment_jobs_result_attempt_id_idx
  on public.song_enrichment_jobs (result_attempt_id)
  where result_attempt_id is not null;

-- A recipe disabled after its job was queued must not leave the client loop
-- waiting forever. Retire only queued work in the caller's library; an already
-- leased worker may finish under the recipe configuration it claimed.
create function public.retire_disabled_enrichment_jobs(p_user_id uuid)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  retired_count integer;
begin
  update public.song_enrichment_jobs j
  set
    status = 'failed',
    updated_at = now()
  from public.enrichment_recipes er
  where er.id = j.recipe_id
    and not er.enabled
    and j.status = 'queued'
    and exists (
      select 1
      from public.user_songs us
      where us.user_id = p_user_id and us.song_id = j.song_id
    );

  get diagnostics retired_count = row_count;
  return retired_count;
end;
$$;

revoke execute on function
  public.retire_disabled_enrichment_jobs(uuid)
  from public, anon, authenticated;

grant execute on function
  public.retire_disabled_enrichment_jobs(uuid)
  to service_role;

-- The record and promote calls are two transactions. If a lease expires in
-- that narrow gap, preserve the billable evidence but close its decision as a
-- stale rejection; it can never remain an undecided orphan.
create function public.reject_stale_song_enrichment_attempt(
  p_attempt_id uuid,
  p_job_id uuid,
  p_lease_token uuid
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  current_job public.song_enrichment_jobs%rowtype;
  current_attempt public.song_enrichment_attempts%rowtype;
begin
  select * into current_job
  from public.song_enrichment_jobs
  where id = p_job_id
  for update;

  select * into current_attempt
  from public.song_enrichment_attempts
  where id = p_attempt_id
  for update;

  if not found
     or current_attempt.job_id <> p_job_id
     or current_attempt.lease_token <> p_lease_token
     or current_attempt.decision <> 'pending' then
    return false;
  end if;

  if current_job.status = 'leased'
     and current_job.lease_token = p_lease_token
     and current_job.lease_expires_at > now() then
    return false;
  end if;

  update public.song_enrichment_attempts
  set
    decision = 'rejected',
    decision_reason = 'stale_lease',
    decided_at = now()
  where id = current_attempt.id;

  return true;
end;
$$;

revoke execute on function
  public.reject_stale_song_enrichment_attempt(uuid, uuid, uuid)
  from public, anon, authenticated;

grant execute on function
  public.reject_stale_song_enrichment_attempt(uuid, uuid, uuid)
  to service_role;
