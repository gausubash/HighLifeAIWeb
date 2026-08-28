alter table public.ml_datasets enable row level security;
alter table public.ml_training_jobs enable row level security;
alter table public.ml_models enable row level security;

drop policy if exists ml_datasets_owner_all on public.ml_datasets;
create policy ml_datasets_owner_all
  on public.ml_datasets for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists ml_training_jobs_owner_all on public.ml_training_jobs;
create policy ml_training_jobs_owner_all
  on public.ml_training_jobs for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists ml_models_owner_all on public.ml_models;
create policy ml_models_owner_all
  on public.ml_models for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

grant select, insert, update, delete on public.ml_datasets to authenticated;
grant select, insert, update, delete on public.ml_training_jobs to authenticated;
grant select, insert, update, delete on public.ml_models to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'datasets',
  'datasets',
  false,
  209715200,
  array['application/zip', 'application/x-zip-compressed', 'application/octet-stream']::text[]
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists datasets_owner_select on storage.objects;
create policy datasets_owner_select on storage.objects for select to authenticated
  using (bucket_id = 'datasets' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists datasets_owner_insert on storage.objects;
create policy datasets_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'datasets' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists datasets_owner_update on storage.objects;
create policy datasets_owner_update on storage.objects for update to authenticated
  using (bucket_id = 'datasets' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'datasets' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists datasets_owner_delete on storage.objects;
create policy datasets_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'datasets' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists models_owner_select on storage.objects;
create policy models_owner_select on storage.objects for select to authenticated
  using (bucket_id = 'models' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists models_owner_insert on storage.objects;
create policy models_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'models' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists models_owner_update on storage.objects;
create policy models_owner_update on storage.objects for update to authenticated
  using (bucket_id = 'models' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'models' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists models_owner_delete on storage.objects;
create policy models_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'models' and (storage.foldername(name))[1] = auth.uid()::text);
