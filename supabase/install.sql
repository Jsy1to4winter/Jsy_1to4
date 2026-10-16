-- Complete installation/update. Preserves existing profiles and files.
begin;
-- Run in Supabase SQL Editor as project owner. Never put a privileged key in HTML.
-- Existing fuguang row and owner_id are preserved. For a new project, replace
-- YOUR_ADMIN_EMAIL with an existing Auth user's email before running.
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

-- Execute AFTER supabase/setup.sql. Preserves fuguang and all existing media.
create table if not exists public.homepage_admins (
  user_id uuid primary key references auth.users(id)
);
insert into public.homepage_admins(user_id)
select owner_id from public.homepage_profiles where slug='fuguang'
on conflict do nothing;

do $$ begin
  if not exists (select 1 from public.homepage_admins) then
    raise exception 'Run setup.sql and assign the fuguang administrator first';
  end if;
end $$;

-- This directory is private: never expose internal Auth emails or any passwords.
create table if not exists public.homepage_editors (
  slug text primary key references public.homepage_profiles(slug),
  user_id uuid not null unique references auth.users(id),
  login_email text not null unique,
  created_at timestamptz not null default now()
);
create table if not exists public.homepage_login_limits (
  slug text primary key references public.homepage_editors(slug) on delete cascade,
  window_started_at timestamptz not null default now(),
  attempts integer not null default 0
);
alter table public.homepage_admins enable row level security;
alter table public.homepage_editors enable row level security;
alter table public.homepage_login_limits enable row level security;
revoke all on public.homepage_admins, public.homepage_editors, public.homepage_login_limits from public, anon, authenticated;
grant all on public.homepage_admins, public.homepage_editors, public.homepage_login_limits to service_role;
grant select, insert, update on public.homepage_profiles to service_role;

-- All below RPCs are backend-only. Calls from a browser are denied.
create or replace function public.homepage_take_login_attempt(p_slug text)
returns boolean language plpgsql set search_path='' as $$
declare n integer;
begin
  insert into public.homepage_login_limits as limits(slug, window_started_at, attempts)
  values(p_slug, clock_timestamp(), 1)
  on conflict(slug) do update set
    window_started_at = case when limits.window_started_at < clock_timestamp()-interval '15 minutes' then clock_timestamp() else limits.window_started_at end,
    attempts = case when limits.window_started_at < clock_timestamp()-interval '15 minutes' then 1 else limits.attempts+1 end
  returning attempts into n;
  return n <= 20;
end $$;

create or replace function public.homepage_create_editor(p_slug text, p_user_id uuid, p_email text)
returns void language plpgsql set search_path='' as $$
begin
  if p_slug !~ '^[a-z0-9][a-z0-9_-]{2,63}$' or p_slug='fuguang' then
    raise exception 'Invalid profile slug';
  end if;
  insert into public.homepage_profiles(slug,owner_id,profile_data) values(p_slug,p_user_id,'{}'::jsonb);
  insert into public.homepage_editors(slug,user_id,login_email) values(p_slug,p_user_id,p_email);
end $$;

-- Replace the identity on password reset. Previously issued access tokens
-- immediately lose write access through owner_id RLS, even before token expiry.
create or replace function public.homepage_replace_editor(p_slug text, p_expected_user uuid, p_new_user uuid, p_email text)
returns void language plpgsql set search_path='' as $$
declare current_user_id uuid;
begin
  select user_id into current_user_id from public.homepage_editors where slug=p_slug for update;
  if current_user_id is null or current_user_id<>p_expected_user then raise exception 'Editor changed; retry'; end if;
  update public.homepage_profiles set owner_id=p_new_user where slug=p_slug and owner_id=current_user_id;
  if not found then raise exception 'Profile owner does not match editor'; end if;
  update public.homepage_editors set user_id=p_new_user,login_email=p_email where slug=p_slug;
  delete from public.homepage_login_limits where slug=p_slug;
end $$;

revoke all on function public.homepage_take_login_attempt(text) from public, anon, authenticated;
revoke all on function public.homepage_create_editor(text,uuid,text) from public, anon, authenticated;
revoke all on function public.homepage_replace_editor(text,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.homepage_take_login_attempt(text) to service_role;
grant execute on function public.homepage_create_editor(text,uuid,text) to service_role;
grant execute on function public.homepage_replace_editor(text,uuid,uuid,text) to service_role;
commit;
