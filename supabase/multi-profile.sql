-- Execute AFTER supabase/setup.sql. Preserves fuguang and all existing media.
begin;
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
