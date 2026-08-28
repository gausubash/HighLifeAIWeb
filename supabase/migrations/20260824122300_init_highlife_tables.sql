-- HighLife workspace tables (auth-owned projects, analyses, results, jobs).

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, split_part(coalesce(new.email, ''), '@', 1))
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  description text,
  jurisdiction text not null default 'victoria',
  policy_version text not null default 'draft-v1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists projects_owner_updated_idx
  on public.projects (owner_id, updated_at desc);

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

create table if not exists public.analyses (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  source_file_name text not null,
  status text not null default 'queued',
  progress integer not null default 0,
  current_stage text not null default 'queued',
  error_message text,
  model_versions jsonb,
  software_commit text,
  page_count integer,
  unit_count integer,
  review_count integer,
  storage_path text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create index if not exists analyses_project_created_idx
  on public.analyses (project_id, created_at desc);
create index if not exists analyses_owner_idx
  on public.analyses (owner_id);

create table if not exists public.analysis_results (
  analysis_id uuid primary key references public.analyses (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  result jsonb not null default '{}'::jsonb,
  scale_info jsonb,
  overlays jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

drop trigger if exists analysis_results_set_updated_at on public.analysis_results;
create trigger analysis_results_set_updated_at
  before update on public.analysis_results
  for each row execute function public.set_updated_at();

create table if not exists public.analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references public.analyses (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'queued',
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create index if not exists analysis_jobs_status_idx
  on public.analysis_jobs (status, created_at);
