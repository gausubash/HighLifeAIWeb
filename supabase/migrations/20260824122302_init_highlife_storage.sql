insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'plans',
  'plans',
  false,
  52428800,
  array['application/pdf', 'image/png', 'image/jpeg', 'image/webp']::text[]
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit)
values ('models', 'models', false, 1073741824)
on conflict (id) do nothing;

drop policy if exists plans_owner_select on storage.objects;
create policy plans_owner_select
  on storage.objects for select to authenticated
  using (bucket_id = 'plans' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists plans_owner_insert on storage.objects;
create policy plans_owner_insert
  on storage.objects for insert to authenticated
  with check (bucket_id = 'plans' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists plans_owner_update on storage.objects;
create policy plans_owner_update
  on storage.objects for update to authenticated
  using (bucket_id = 'plans' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'plans' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists plans_owner_delete on storage.objects;
create policy plans_owner_delete
  on storage.objects for delete to authenticated
  using (bucket_id = 'plans' and (storage.foldername(name))[1] = auth.uid()::text);
