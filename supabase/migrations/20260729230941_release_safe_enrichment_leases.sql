-- A worker that fails before the billable model call can return its whole
-- same-token batch immediately instead of waiting for lease expiry.

create function public.release_song_enrichment_jobs(
  p_job_ids uuid[],
  p_lease_token uuid
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  released_count integer;
begin
  update public.song_enrichment_jobs
  set
    status = 'queued',
    lease_token = null,
    lease_expires_at = null,
    expected_revision = null,
    updated_at = now()
  where id = any(p_job_ids)
    and status = 'leased'
    and lease_token = p_lease_token;

  get diagnostics released_count = row_count;
  return released_count;
end;
$$;

revoke execute on function
  public.release_song_enrichment_jobs(uuid[], uuid)
  from public, anon, authenticated;

grant execute on function
  public.release_song_enrichment_jobs(uuid[], uuid)
  to service_role;
