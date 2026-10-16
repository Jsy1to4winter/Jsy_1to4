-- Run in Supabase SQL Editor as project owner. Never put a privileged key in HTML.
-- Existing fuguang row and owner_id are preserved. For a new project, replace
-- YOUR_ADMIN_EMAIL with an existing Auth user's email before running.
begin;
create table if not exists public.homepage_profiles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  owner_id uuid not null references auth.users(id),
  profile_data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
-- Fail rather than silently assigning an existing homepage to another account.
do $$
declare admin_id uuid;
begin
  if not exists (select 1 from public.homepage_profiles where slug = 'fuguang') then
    select id into admin_id from auth.users where lower(email) = lower('YOUR_ADMIN_EMAIL');
    if admin_id is null then raise exception 'Replace YOUR_ADMIN_EMAIL with your existing Supabase Auth administrator email'; end if;
    insert into public.homepage_profiles(slug, owner_id) values ('fuguang', admin_id);
  end if;
  if exists (select 1 from public.homepage_profiles where slug='fuguang' and owner_id is null) then
    raise exception 'Existing homepage has no owner_id. Assign the correct Auth user UUID before setup';
  end if;
end $$;

alter table public.homepage_profiles enable row level security;
-- Restrictive policies also constrain pre-existing permissive policies.
drop policy if exists homepage_read on public.homepage_profiles;
create policy homepage_read on public.homepage_profiles for select to anon, authenticated using (true);
drop policy if exists homepage_owner_update on public.homepage_profiles;
create policy homepage_owner_update on public.homepage_profiles for update to authenticated
using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
drop policy if exists homepage_write_guard on public.homepage_profiles;
-- Separate operation guards avoid depending on HTTP method for database authorization.
drop policy if exists homepage_update_guard on public.homepage_profiles;
create policy homepage_update_guard on public.homepage_profiles as restrictive for update to anon, authenticated
using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
drop policy if exists homepage_insert_guard on public.homepage_profiles;
create policy homepage_insert_guard on public.homepage_profiles as restrictive for insert to anon, authenticated with check (false);
drop policy if exists homepage_delete_guard on public.homepage_profiles;
create policy homepage_delete_guard on public.homepage_profiles as restrictive for delete to anon, authenticated using (false);
revoke all on public.homepage_profiles from anon, authenticated;
grant select on public.homepage_profiles to anon, authenticated;
grant update(profile_data, updated_at) on public.homepage_profiles to authenticated;

-- Every update receives a server timestamp, so clients cannot reuse an old version.
create or replace function public.homepage_touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := clock_timestamp(); return new; end $$;
drop trigger if exists homepage_touch_updated_at on public.homepage_profiles;
create trigger homepage_touch_updated_at before update on public.homepage_profiles
for each row execute function public.homepage_touch_updated_at();

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('homepage-media', 'homepage-media', true, 52428800,
 array['image/jpeg','image/png','image/webp','image/gif','image/avif','audio/mpeg','audio/mp3'])
on conflict (id) do update set public=true, file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types;
-- Public bucket: all files here are intentionally visible to visitors. Do not upload private files.
drop policy if exists homepage_storage_read on storage.objects;
create policy homepage_storage_read on storage.objects for select to anon, authenticated
using (bucket_id = 'homepage-media');
drop policy if exists homepage_storage_owner on storage.objects;
create policy homepage_storage_owner on storage.objects for all to authenticated
using (bucket_id='homepage-media' and exists (
 select 1 from public.homepage_profiles p where p.slug=(storage.foldername(name))[1] and p.owner_id=(select auth.uid())
)) with check (bucket_id='homepage-media' and exists (
 select 1 from public.homepage_profiles p where p.slug=(storage.foldername(name))[1] and p.owner_id=(select auth.uid())
));
-- Guards only constrain this bucket, preserving policies for unrelated buckets.
drop policy if exists homepage_storage_insert_guard on storage.objects;
create policy homepage_storage_insert_guard on storage.objects as restrictive for insert to anon, authenticated
with check (bucket_id <> 'homepage-media' or exists (
 select 1 from public.homepage_profiles p where p.slug=(storage.foldername(name))[1] and p.owner_id=(select auth.uid())
));
drop policy if exists homepage_storage_update_guard on storage.objects;
create policy homepage_storage_update_guard on storage.objects as restrictive for update to anon, authenticated
using (bucket_id <> 'homepage-media' or exists (
 select 1 from public.homepage_profiles p where p.slug=(storage.foldername(name))[1] and p.owner_id=(select auth.uid())
)) with check (bucket_id <> 'homepage-media' or exists (
 select 1 from public.homepage_profiles p where p.slug=(storage.foldername(name))[1] and p.owner_id=(select auth.uid())
));
drop policy if exists homepage_storage_delete_guard on storage.objects;
create policy homepage_storage_delete_guard on storage.objects as restrictive for delete to anon, authenticated
using (bucket_id <> 'homepage-media' or exists (
 select 1 from public.homepage_profiles p where p.slug=(storage.foldername(name))[1] and p.owner_id=(select auth.uid())
));
commit;
