-- Upgrade after multi-profile.sql. No existing profile is deleted by this migration.
begin;
alter table public.homepage_profiles add column if not exists deleted_at timestamptz;
alter table public.homepage_editors add column if not exists deleted_at timestamptz;
alter table public.homepage_editors add column if not exists purged_at timestamptz;

-- A disabled profile disappears from public reads and all browser writes.
-- Storage write policies already consult homepage_profiles and inherit this filter.
drop policy if exists homepage_active_read on public.homepage_profiles;
create policy homepage_active_read on public.homepage_profiles as restrictive
for select to anon, authenticated using (deleted_at is null);
drop policy if exists homepage_active_update on public.homepage_profiles;
create policy homepage_active_update on public.homepage_profiles as restrictive
for update to anon, authenticated using (deleted_at is null) with check (deleted_at is null);

create or replace function public.homepage_replace_editor(p_slug text, p_expected_user uuid, p_new_user uuid, p_email text)
returns void language plpgsql set search_path='' as $$
declare current_user_id uuid;
begin
  select user_id into current_user_id from public.homepage_editors
    where slug=p_slug and deleted_at is null for update;
  if current_user_id is null or current_user_id<>p_expected_user then raise exception 'Editor changed or deleted; retry'; end if;
  update public.homepage_profiles set owner_id=p_new_user where slug=p_slug and owner_id=current_user_id and deleted_at is null;
  if not found then raise exception 'Profile owner does not match editor'; end if;
  update public.homepage_editors set user_id=p_new_user,login_email=p_email where slug=p_slug;
  delete from public.homepage_login_limits where slug=p_slug;
end $$;

-- Disable first, so old sessions lose write access before file cleanup starts.
create or replace function public.homepage_disable_editor(p_slug text)
returns uuid language plpgsql set search_path='' as $$
declare editor_id uuid;
begin
  if p_slug='fuguang' then raise exception 'Cannot delete the main profile'; end if;
  select user_id into editor_id from public.homepage_editors where slug=p_slug for update;
  if editor_id is null then return null; end if;
  update public.homepage_editors set deleted_at=coalesce(deleted_at,clock_timestamp()) where slug=p_slug;
  update public.homepage_profiles set deleted_at=coalesce(deleted_at,clock_timestamp()) where slug=p_slug;
  return editor_id;
end $$;

-- Called only after Storage reports that the profile directory is empty.
-- Keep a minimal tombstone so an old shared URL can never be reassigned.
create or replace function public.homepage_purge_editor(p_slug text, p_expected_user uuid)
returns void language plpgsql set search_path='' as $$
declare editor_id uuid;
begin
  if p_slug='fuguang' then raise exception 'Cannot delete the main profile'; end if;
  select user_id into editor_id from public.homepage_editors
    where slug=p_slug and deleted_at is not null for update;
  if editor_id is null or editor_id<>p_expected_user then raise exception 'Profile not disabled or owner changed'; end if;
  update public.homepage_profiles set profile_data='{}'::jsonb where slug=p_slug and deleted_at is not null;
  update public.homepage_editors set purged_at=clock_timestamp() where slug=p_slug;
  delete from public.homepage_login_limits where slug=p_slug;
end $$;
revoke all on function public.homepage_disable_editor(text) from public, anon, authenticated;
revoke all on function public.homepage_purge_editor(text,uuid) from public, anon, authenticated;
grant execute on function public.homepage_disable_editor(text) to service_role;
grant execute on function public.homepage_purge_editor(text,uuid) to service_role;
commit;
