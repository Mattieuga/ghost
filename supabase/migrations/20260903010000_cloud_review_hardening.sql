-- Hardening from the 2026-09-03 review of sharing and synced folders.
--
-- 1. Duplicating an item requires edit rights on the destination parent, not
--    only on the source, so an editor of a shared subtree cannot write copies
--    into the owner's top level.
-- 2. A synced root can be trashed or renamed only by its workspace owner.
-- 3. Durable update IDs are assigned under a per-document lock, so ID order
--    is commit order and a client that reads "everything after ID n" never
--    skips an update that was inserted earlier but committed later.
-- 4. Redeeming a link records the caller's profile, so guests appear by name
--    in the owner's Share sheet.
-- 5. The sharer's name shown to members is a display name or the local part
--    of the email, never the full address.
-- 6. An item reachable through two memberships resolves to the same shared
--    root every time (the shallowest one).
-- 7. Invitations attach only to confirmed email addresses.
-- 8. Uploaded version timestamps are clamped to now, so a clock in the
--    future cannot suppress automatic versions.
-- 9. An item name is one path segment: never '.', '..', or '.ghost', and
--    never a separator or control character, because a member's Mac turns
--    it into a path under its Shared root.

-- 1. Duplicate into an editable parent only.
create or replace function public.cloud_duplicate_item(target_item_id uuid)
returns public.cloud_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  source_item public.cloud_items;
  stem text;
  candidate_name text;
  extension text := '';
  suffix text := ' copy';
  counter integer := 2;
  new_item_id uuid;
  result public.cloud_items;
begin
  if not private.cloud_has_role(target_item_id, 2, current_user_id) then
    raise exception 'Cloud item is not editable' using errcode = '42501';
  end if;

  select * into source_item
  from public.cloud_items
  where id = target_item_id and deleted_at is null;
  if source_item.id is null then
    raise exception 'Cloud item not found';
  end if;

  -- The copy lands next to the source, so the caller needs edit rights
  -- there too. At the top level that means owning the workspace.
  if source_item.parent_id is null then
    if not exists (
      select 1 from public.cloud_workspaces as workspace
      where workspace.id = source_item.workspace_id and workspace.owner_id = current_user_id
    ) then
      raise exception 'Only the owner can duplicate a top-level item' using errcode = '42501';
    end if;
  elsif not private.cloud_has_role(source_item.parent_id, 2, current_user_id) then
    raise exception 'Cloud parent is not editable' using errcode = '42501';
  end if;

  if source_item.kind = 'document' and lower(right(source_item.name, 3)) = '.md' then
    stem := left(source_item.name, char_length(source_item.name) - 3);
    extension := right(source_item.name, 3);
  else
    stem := source_item.name;
  end if;

  loop
    candidate_name := left(stem, 255 - char_length(suffix) - char_length(extension))
      || suffix || extension;
    exit when not exists (
      select 1
      from public.cloud_items as sibling
      where sibling.workspace_id = source_item.workspace_id
        and sibling.parent_id is not distinct from source_item.parent_id
        and sibling.deleted_at is null
        and lower(sibling.name) = lower(candidate_name)
    );
    suffix := ' copy ' || counter::text;
    counter := counter + 1;
    if counter > 100 then
      raise exception 'Could not choose a name for the duplicated Cloud item';
    end if;
  end loop;

  new_item_id := private.cloud_duplicate_item_recursive(
    source_item.id,
    source_item.parent_id,
    candidate_name,
    current_user_id
  );
  select * into result from public.cloud_items where id = new_item_id;
  return result;
end
$$;

-- 2. Synced roots belong to their owner.
create or replace function private.cloud_require_root_owner(target_item_id uuid, current_user_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  item public.cloud_items;
begin
  select * into item from public.cloud_items where id = target_item_id;
  if item.id is null or item.root_kind is null then
    return;
  end if;
  if not exists (
    select 1 from public.cloud_workspaces as workspace
    where workspace.id = item.workspace_id and workspace.owner_id = current_user_id
  ) then
    raise exception 'Only the owner can change a synced root' using errcode = '42501';
  end if;
end
$$;

create or replace function public.cloud_rename_item(
  target_item_id uuid,
  item_name text
)
returns public.cloud_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_name text := btrim(item_name);
  existing_kind text;
  result public.cloud_items;
begin
  if not private.cloud_has_role(target_item_id, 2, auth.uid()) then
    raise exception 'Cloud item is not editable' using errcode = '42501';
  end if;
  perform private.cloud_require_root_owner(target_item_id, auth.uid());
  select kind into existing_kind from public.cloud_items where id = target_item_id;
  if normalized_name = '' or char_length(normalized_name) > 255
    or position('/' in normalized_name) > 0 then
    raise exception 'Invalid Cloud item name';
  end if;
  if existing_kind = 'document' and lower(normalized_name) not like '%.md' then
    normalized_name := normalized_name || '.md';
  end if;
  update public.cloud_items
  set name = normalized_name, updated_at = now()
  where id = target_item_id and deleted_at is null
  returning * into result;
  return result;
exception
  when unique_violation then
    raise exception 'A Cloud item with that name already exists' using errcode = '23505';
end
$$;

create or replace function public.cloud_trash_item(target_item_id uuid)
returns public.cloud_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  result public.cloud_items;
begin
  if not private.cloud_has_role(target_item_id, 2, current_user_id) then
    raise exception 'Cloud item is not editable' using errcode = '42501';
  end if;
  perform private.cloud_require_root_owner(target_item_id, current_user_id);

  select * into result
  from public.cloud_items
  where id = target_item_id and deleted_at is null;
  if result.id is null then
    raise exception 'Cloud item not found';
  end if;

  with recursive descendants as (
    select id from public.cloud_items where id = target_item_id and deleted_at is null
    union all
    select child.id
    from public.cloud_items as child
    join descendants on child.parent_id = descendants.id
    where child.deleted_at is null
  )
  update public.cloud_items
  set deleted_at = now(), updated_at = now()
  where id in (select id from descendants);

  result.deleted_at := now();
  return result;
end
$$;

-- 3. Update IDs in commit order per document.
create or replace function private.cloud_order_document_updates()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext(new.document_id::text));
  new.id := nextval(pg_get_serial_sequence('public.cloud_document_updates', 'id'));
  return new;
end
$$;

drop trigger if exists cloud_document_updates_ordered on public.cloud_document_updates;
create trigger cloud_document_updates_ordered
before insert on public.cloud_document_updates
for each row execute function private.cloud_order_document_updates();

-- 4. Redeeming records who redeemed, guests included.
create or replace function public.cloud_redeem_share_link(raw_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  link public.cloud_share_links;
  item public.cloud_items;
  owner_id uuid;
  effective text;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select * into link
  from public.cloud_share_links
  where token_hash = encode(extensions.digest(coalesce(raw_token, ''), 'sha256'), 'hex')
    and revoked_at is null
    and (expires_at is null or expires_at > now());
  if link.id is null then
    raise exception 'This link is no longer valid' using errcode = '42501';
  end if;
  select * into item from public.cloud_items where id = link.item_id and deleted_at is null;
  if item.id is null then
    raise exception 'This link is no longer valid' using errcode = '42501';
  end if;

  insert into public.cloud_profiles (id, email, display_name)
  values (
    current_user_id,
    auth.jwt() ->> 'email',
    nullif(btrim(auth.jwt() -> 'user_metadata' ->> 'display_name'), '')
  )
  on conflict (id) do update
  set display_name = coalesce(public.cloud_profiles.display_name, excluded.display_name),
      updated_at = now();

  select workspace.owner_id into owner_id
  from public.cloud_workspaces as workspace
  where workspace.id = item.workspace_id;
  if owner_id <> current_user_id then
    perform private.cloud_upsert_membership(
      item.id,
      current_user_id,
      link.role,
      coalesce(link.created_by, current_user_id)
    );
  end if;
  effective := private.cloud_effective_role(item.id, current_user_id);
  return to_jsonb(item) || jsonb_build_object('role', effective);
end
$$;

-- 5 and 6. Sharer shown by name, and one shared root per item.
create or replace function public.cloud_list_visible_items()
returns table (
  id uuid,
  workspace_id uuid,
  parent_id uuid,
  kind text,
  name text,
  root_kind text,
  created_by uuid,
  created_at timestamptz,
  updated_at timestamptz,
  deleted_at timestamptz,
  access_role text,
  shared_root_id uuid,
  shared_by text,
  shared_out boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with recursive shared as (
    select item.id, item.workspace_id, item.parent_id, item.kind, item.name, item.root_kind,
      item.created_by, item.created_at, item.updated_at, item.deleted_at,
      membership.item_id as shared_root_id, membership.role as access_role, 0 as depth
    from public.cloud_memberships as membership
    join public.cloud_items as item on item.id = membership.item_id
    join public.cloud_workspaces as workspace on workspace.id = item.workspace_id
    where membership.user_id = auth.uid()
      and workspace.owner_id <> auth.uid()
      and item.deleted_at is null

    union all

    select child.id, child.workspace_id, child.parent_id, child.kind, child.name, child.root_kind,
      child.created_by, child.created_at, child.updated_at, child.deleted_at,
      shared.shared_root_id, shared.access_role, shared.depth + 1
    from public.cloud_items as child
    join shared on child.parent_id = shared.id
    where child.deleted_at is null
  ), ranked_shared as (
    select distinct on (shared.id) shared.*
    from shared
    order by shared.id, private.cloud_role_rank(shared.access_role) desc, shared.depth desc, shared.shared_root_id
  )
  select item.id, item.workspace_id, item.parent_id, item.kind, item.name, item.root_kind,
    item.created_by, item.created_at, item.updated_at, item.deleted_at,
    'owner'::text as access_role,
    null::uuid as shared_root_id,
    null::text as shared_by,
    exists (
      select 1 from public.cloud_memberships as membership
      where membership.item_id = item.id and membership.user_id <> auth.uid()
    ) or exists (
      select 1 from public.cloud_share_links as link
      where link.item_id = item.id
        and link.revoked_at is null
        and (link.expires_at is null or link.expires_at > now())
    ) or exists (
      select 1 from public.cloud_invitations as invitation
      where invitation.item_id = item.id
        and invitation.accepted_at is null
        and invitation.revoked_at is null
    ) as shared_out
  from public.cloud_items as item
  join public.cloud_workspaces as workspace on workspace.id = item.workspace_id
  where workspace.owner_id = auth.uid() and item.deleted_at is null

  union all

  select ranked.id, ranked.workspace_id, ranked.parent_id, ranked.kind, ranked.name, ranked.root_kind,
    ranked.created_by, ranked.created_at, ranked.updated_at, ranked.deleted_at,
    ranked.access_role,
    ranked.shared_root_id,
    coalesce(nullif(btrim(profile.display_name), ''), split_part(profile.email, '@', 1)) as shared_by,
    false as shared_out
  from ranked_shared as ranked
  join public.cloud_workspaces as workspace on workspace.id = ranked.workspace_id
  left join public.cloud_profiles as profile on profile.id = workspace.owner_id
$$;

-- 7. Only a confirmed address can collect its invitations.
create or replace function public.cloud_accept_invitations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  accepted integer := 0;
  invitation record;
begin
  if current_user_id is null or current_email = ''
    or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    return 0;
  end if;
  if not exists (
    select 1 from auth.users as account
    where account.id = current_user_id and account.email_confirmed_at is not null
  ) then
    return 0;
  end if;

  for invitation in
    select inv.id, inv.item_id, inv.role, inv.invited_by
    from public.cloud_invitations as inv
    join public.cloud_items as item on item.id = inv.item_id
    where lower(inv.email) = current_email
      and inv.accepted_at is null
      and inv.revoked_at is null
      and item.deleted_at is null
  loop
    perform private.cloud_upsert_membership(
      invitation.item_id,
      current_user_id,
      invitation.role,
      coalesce(invitation.invited_by, current_user_id)
    );
    update public.cloud_invitations
    set accepted_at = now(), accepted_by = current_user_id
    where id = invitation.id;
    accepted := accepted + 1;
  end loop;
  return accepted;
end
$$;

-- 8. Version timestamps never come from the future.
create or replace function private.cloud_clamp_version_time()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.created_at := least(new.created_at, now());
  return new;
end
$$;

drop trigger if exists cloud_document_versions_clamped on public.cloud_document_versions;
create trigger cloud_document_versions_clamped
before insert on public.cloud_document_versions
for each row execute function private.cloud_clamp_version_time();

-- 9. Names stay within one path segment.
alter table public.cloud_items drop constraint if exists cloud_items_name_safe;
alter table public.cloud_items
  add constraint cloud_items_name_safe
  check (
    name not in ('.', '..')
    and lower(name) <> '.ghost'
    and name !~ '[[:cntrl:]/\\]'
  );

revoke all on function private.cloud_require_root_owner(uuid, uuid) from public, anon, authenticated;
revoke all on function private.cloud_order_document_updates() from public, anon, authenticated;
revoke all on function private.cloud_clamp_version_time() from public, anon, authenticated;
revoke all on function public.cloud_duplicate_item(uuid) from public, anon;
revoke all on function public.cloud_rename_item(uuid, text) from public, anon;
revoke all on function public.cloud_trash_item(uuid) from public, anon;
revoke all on function public.cloud_redeem_share_link(text) from public, anon;
revoke all on function public.cloud_list_visible_items() from public, anon;
revoke all on function public.cloud_accept_invitations() from public, anon;
grant execute on function public.cloud_duplicate_item(uuid) to authenticated;
grant execute on function public.cloud_rename_item(uuid, text) to authenticated;
grant execute on function public.cloud_trash_item(uuid) to authenticated;
grant execute on function public.cloud_redeem_share_link(text) to authenticated;
grant execute on function public.cloud_list_visible_items() to authenticated;
grant execute on function public.cloud_accept_invitations() to authenticated;
