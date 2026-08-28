-- Model Studio: datasets, training jobs, trained weights.

create table if not exists public.ml_datasets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  description text,
  task text not null default 'detect' check (task in ('detect', 'segment')),
  class_names text[] not null default '{}',
  storage_path text,
  image_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ml_datasets_owner_idx on public.ml_datasets (owner_id, updated_at desc);

drop trigger if exists ml_datasets_set_updated_at on public.ml_datasets;
create trigger ml_datasets_set_updated_at
  before update on public.ml_datasets
  for each row execute function public.set_updated_at();

create table if not exists public.ml_training_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  dataset_id uuid not null references public.ml_datasets (id) on delete cascade,
  task text not null check (task in ('detect', 'segment')),
  base_model text not null default 'yolov8n.pt',
  epochs integer not null default 30,
  imgsz integer not null default 640,
  batch integer not null default 2,
  status text not null default 'queued',
  progress integer not null default 0,
  metrics jsonb,
  log_tail text,
  error text,
  output_model_id uuid,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create index if not exists ml_training_jobs_owner_idx
  on public.ml_training_jobs (owner_id, created_at desc);

create table if not exists public.ml_models (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  dataset_id uuid references public.ml_datasets (id) on delete set null,
  training_job_id uuid references public.ml_training_jobs (id) on delete set null,
  name text not null,
  task text not null check (task in ('detect', 'segment')),
  architecture text not null,
  storage_path text not null,
  class_names text[] not null default '{}',
  metrics jsonb,
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists ml_models_owner_idx on public.ml_models (owner_id, created_at desc);
create unique index if not exists ml_models_one_active_per_owner
  on public.ml_models (owner_id) where is_active;
