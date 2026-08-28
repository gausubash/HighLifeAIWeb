-- Phase 6 + 9: analysis job claim, retries, heartbeat / lease.

alter table public.analysis_jobs
  add column if not exists attempt integer not null default 0,
  add column if not exists max_attempts integer not null default 3,
  add column if not exists payload jsonb not null default '{}'::jsonb,
  add column if not exists storage_path text,
  add column if not exists claimed_by text,
  add column if not exists claimed_at timestamptz,
  add column if not exists heartbeat_at timestamptz,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists last_error text,
  add column if not exists result jsonb;

create index if not exists analysis_jobs_claim_idx
  on public.analysis_jobs (status, lease_expires_at, created_at);

-- Default project policy pack version (Phase 8).
alter table public.projects
  alter column policy_version set default 'highlife_v1';

comment on column public.analysis_jobs.attempt is 'Number of claim/start attempts (Phase 9 retries)';
comment on column public.analysis_jobs.lease_expires_at is 'Worker lease expiry; reclaim when past (Phase 9)';
