-- Review fixes for sharing and live updates.
--
-- 1. A helper called from a policy runs as the role the policy runs for,
--    so that role needs EXECUTE on it. `cloud_asset_document` sits inside
--    the Storage policies and `cloud_can_watch_topic` inside the Realtime
--    policy; both had been revoked from `authenticated`, so every image
--    upload and every live tree subscription was refused. Helpers that only
--    security-definer RPCs call stay revoked.
-- 2. Access that came through the link follows the link. A membership made
--    by redeeming records the link; turning the link off removes those
--    memberships and changing its role changes theirs. People shared with
--    by email are untouched, as in a Google Doc.
-- 3. A workspace's tree topic is the owner's alone. It carried the ID and
--    timing of every change in the workspace to anyone holding a share on
--    one note in it. Members now hear about the items shared with them, and
--    anything inside those, on their own user topic.

-- 2. Link-made memberships remember their link.
alter table public.cloud_memberships
  add column if not exists via_link_id uuid references public.cloud_share_links(id) on delete set null;

create index if not exists cloud_memberships_via_link
on public.cloud_memberships (via_link_id)
where via_link_id is not null;

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
    -- Access through the link is recorded as such, so the link's switch
    -- governs it. Someone already shared with by email keeps that grant,
    -- raised to the link's role when that is higher.
    insert into public.cloud_memberships (item_id, user_id, role, granted_by, via_link_id)
    values (item.id, current_user_id, link.role, coalesce(link.created_by, current_user_id), link.id)
    on conflict (item_id, user_id) do update
    set role = case
      when private.cloud_role_rank(excluded.role) > private.cloud_role_rank(public.cloud_memberships.role)
        then excluded.role
      else public.cloud_memberships.role
    end;
  end if;
  effective := private.cloud_effective_role(item.id, current_user_id);
  return to_jsonb(item) || jsonb_build_object('role', effective);
end
$$;

create or replace function public.cloud_set_share_link(target_item_id uuid, link_role text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := private.cloud_require_owner(target_item_id);
  raw_token text;
  link public.cloud_share_links;
begin
  if link_role is null then
    -- Off: whoever came in through the link goes out with it.
    delete from public.cloud_memberships as membership
    using public.cloud_share_links as active
    where active.id = membership.via_link_id
      and active.item_id = target_item_id
      and active.revoked_at is null;
    update public.cloud_share_links
    set revoked_at = now()
    where item_id = target_item_id and revoked_at is null;
    return null;
  end if;
  if link_role not in ('viewer', 'editor') then
    raise exception 'Role must be viewer or editor';
  end if;

  update public.cloud_share_links
  set role = link_role
  where item_id = target_item_id and revoked_at is null and token is not null
  returning * into link;
  if link.id is null then
    raw_token := translate(rtrim(encode(extensions.gen_random_bytes(24), 'base64'), '='), '+/', '-_');
    insert into public.cloud_share_links (item_id, role, token, token_hash, created_by)
    values (
      target_item_id,
      link_role,
      raw_token,
      encode(extensions.digest(raw_token, 'sha256'), 'hex'),
      current_user_id
    )
    returning * into link;
  end if;
  -- Everyone who came in through the link gets the link's role, up or down.
  update public.cloud_memberships
  set role = link_role
  where via_link_id = link.id and role <> link_role;
  return jsonb_build_object(
    'id', link.id,
    'role', link.role,
    'token', link.token,
    'created_at', link.created_at
  );
end
$$;

-- 3. Owners alone on the workspace topic; members hear on their own.
create or replace function private.cloud_can_watch_topic(topic_name text, target_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  workspace uuid;
begin
  if target_user_id is null or topic_name is null then
    return false;
  end if;
  if topic_name = 'ghost-user:' || target_user_id::text then
    return true;
  end if;
  if topic_name not like 'ghost-tree:%' then
    return false;
  end if;
  begin
    workspace := substring(topic_name from 12)::uuid;
  exception when others then
    return false;
  end;
  return exists (
    select 1 from public.cloud_workspaces as w
    where w.id = workspace and w.owner_id = target_user_id
  );
end
$$;

create or replace function private.cloud_items_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  workspace uuid := coalesce(new.workspace_id, old.workspace_id);
  item uuid := coalesce(new.id, old.id);
  -- Both parents of a move, so the folder it left hears too.
  parents uuid[] := array_remove(array[
    case when tg_op <> 'DELETE' then new.parent_id end,
    case when tg_op <> 'INSERT' then old.parent_id end
  ], null);
  payload jsonb := jsonb_build_object('item_id', item);
  member uuid;
begin
  perform private.cloud_notify('ghost-tree:' || workspace::text, payload);
  for member in
    with recursive chain as (
      select unnest(parents) as id
      union all
      select i.parent_id
      from public.cloud_items as i
      join chain on i.id = chain.id
      where i.parent_id is not null
    )
    select distinct m.user_id
    from public.cloud_memberships as m
    where m.item_id = item or m.item_id in (select id from chain)
  loop
    perform private.cloud_notify('ghost-user:' || member::text, payload);
  end loop;
  return null;
end
$$;

-- 1. The roles that run the policies may call their helpers.
grant execute on function private.cloud_asset_document(text) to authenticated;
grant execute on function private.cloud_can_watch_topic(text, uuid) to authenticated;
