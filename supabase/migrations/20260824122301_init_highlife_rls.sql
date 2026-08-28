alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.analyses enable row level security;
alter table public.analysis_results enable row level security;
alter table public.analysis_jobs enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
  on public.profiles for select to authenticated
  using (id = auth.uid());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own
  on public.profiles for insert to authenticated
  with check (id = auth.uid());

drop policy if exists projects_owner_all on public.projects;
create policy projects_owner_all
  on public.projects for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists analyses_owner_all on public.analyses;
create policy analyses_owner_all
  on public.analyses for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists analysis_results_owner_all on public.analysis_results;
create policy analysis_results_owner_all
  on public.analysis_results for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists analysis_jobs_owner_all on public.analysis_jobs;
create policy analysis_jobs_owner_all
  on public.analysis_jobs for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.projects to authenticated;
grant select, insert, update, delete on public.analyses to authenticated;
grant select, insert, update, delete on public.analysis_results to authenticated;
grant select, insert, update, delete on public.analysis_jobs to authenticated;
