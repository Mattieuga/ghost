-- Sharing for synced folders (ADR 0005 Phase 4, carrying ADR 0004's
-- permission model): direct memberships by email, invitations that attach
-- when that email signs in, share links with hashed tokens, a visibility
-- query that spans workspaces for the Shared root, and document heads so a
-- closed document can pull Cloud changes without opening a session.

-- Share links. Only the SHA-256 of a token is stored; the raw token is
-- returned once, when the link is created.
create table if not exists public.cloud_share_links (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.cloud_items(id) on delete cascade,
  role text not null check (role in ('viewer', 'editor')),
  token_hash text not null unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz
);

create index if not exists cloud_share_links_item
on public.cloud_share_links (item_id);

-- Invitations wait for an email address to sign in. A pending invitation is
-- unique per item and address; accepted or revoked rows stay as history.
create table if not exists public.cloud_invitations (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.cloud_items(id) on delete cascade,
  email text not null,
  role text not null check (role in ('viewer', 'editor')),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  revoked_at timestamptz
);

create unique index if not exists cloud_invitations_pending
on public.cloud_invitations (item_id, lower(email))
where accepted_at is null and revoked_at is null;

alter table public.cloud_share_links enable row level security;
alter table public.cloud_invitations enable row level security;
revoke all on public.cloud_share_links from anon, authenticated;
revoke all on public.cloud_invitations from anon, authenticated;

-- Membership rows are written only through the functions below.
create or replace function private.cloud_upsert_membership(
  target_item_id uuid,
  target_user_id uuid,
  member_role text,
  granter_id uuid
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.cloud_memberships (item_id, user_id, role, granted_by)
  values (target_item_id, target_user_id, member_role, granter_id)
  on conflict (item_id, user_id) do update
  set role = case
    when private.cloud_role_rank(excluded.role) > private.cloud_role_rank(public.cloud_memberships.role)
      then excluded.role
    else public.cloud_memberships.role
  end
$$;

create or replace function private.cloud_require_owner(target_item_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'A permanent account is required' using errcode = '42501';
  end if;
  if not private.cloud_has_role(target_item_id, 3, current_user_id) then
    raise exception 'Only the owner can share this item' using errcode = '42501';
  end if;
  return current_user_id;
end
$$;

-- Share with one email address. An existing account becomes a member now;
-- any other address is invited and attaches when it signs in.
create or replace function public.cloud_share_item(
  target_item_id uuid,
  member_email text,
  member_role text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := private.cloud_require_owner(target_item_id);
  normalized_email text := lower(btrim(member_email));
  target_user_id uuid;
  invitation_id uuid;
begin
  if member_role not in ('viewer', 'editor') then
    raise exception 'Role must be viewer or editor';
  end if;
  if normalized_email = '' or position('@' in normalized_email) = 0 then
    raise exception 'Enter an email address';
  end if;
  if normalized_email = lower(coalesce(auth.jwt() ->> 'email', '')) then
    raise exception 'You already own this item';
  end if;

  select id into target_user_id
  from public.cloud_profiles
  where lower(email) = normalized_email
  limit 1;

  if target_user_id is not null then
    perform private.cloud_upsert_membership(target_item_id, target_user_id, member_role, current_user_id);
    update public.cloud_memberships
    set role = member_role
    where item_id = target_item_id and user_id = target_user_id;
    return jsonb_build_object(
      'kind', 'member',
      'user_id', target_user_id,
      'email', normalized_email,
      'role', member_role
    );
  end if;

  update public.cloud_invitations
  set role = member_role
  where item_id = target_item_id
    and lower(email) = normalized_email
    and accepted_at is null
    and revoked_at is null
  returning id into invitation_id;
  if invitation_id is null then
    insert into public.cloud_invitations (item_id, email, role, invited_by)
    values (target_item_id, normalized_email, member_role, current_user_id)
    returning id into invitation_id;
  end if;
  return jsonb_build_object(
    'kind', 'invited',
    'invitation_id', invitation_id,
    'email', normalized_email,
    'role', member_role
  );
end
$$;

create or replace function public.cloud_revoke_access(
  target_item_id uuid,
  member_user_id uuid default null,
  invitation_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := private.cloud_require_owner(target_item_id);
begin
  if member_user_id is not null then
    delete from public.cloud_memberships
    where item_id = target_item_id and user_id = member_user_id;
  end if;
  if invitation_id is not null then
    update public.cloud_invitations
    set revoked_at = now()
    where id = invitation_id and item_id = target_item_id and revoked_at is null;
  end if;
end
$$;

-- Attach pending invitations for the signed-in address. Clients call this
-- after sign-in and before listing what is visible.
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

-- Create a share link. The token is returned here and never stored.
create or replace function public.cloud_create_share_link(
  target_item_id uuid,
  link_role text,
  expires_in_hours integer default null
)
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
  if link_role not in ('viewer', 'editor') then
    raise exception 'Role must be viewer or editor';
  end if;
  raw_token := translate(rtrim(encode(extensions.gen_random_bytes(24), 'base64'), '='), '+/', '-_');
  insert into public.cloud_share_links (item_id, role, token_hash, created_by, expires_at)
  values (
    target_item_id,
    link_role,
    encode(extensions.digest(raw_token, 'sha256'), 'hex'),
    current_user_id,
    case when expires_in_hours is null then null else now() + make_interval(hours => expires_in_hours) end
  )
  returning * into link;
  return jsonb_build_object(
    'id', link.id,
    'token', raw_token,
    'role', link.role,
    'created_at', link.created_at,
    'expires_at', link.expires_at
  );
end
$$;

create or replace function public.cloud_revoke_share_link(link_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  link public.cloud_share_links;
begin
  select * into link from public.cloud_share_links where id = link_id;
  if link.id is null then
    raise exception 'Share link not found';
  end if;
  perform private.cloud_require_owner(link.item_id);
  update public.cloud_share_links set revoked_at = now() where id = link_id and revoked_at is null;
end
$$;

-- Redeem a link for the signed-in user, guests included. Membership is
-- granted at the link's role; an existing higher role is kept.
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

create or replace function public.cloud_leave_item(target_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  delete from public.cloud_memberships
  where item_id = target_item_id and user_id = current_user_id;
end
$$;

-- Everything the caller can see: their own live items, and the subtree
-- under each item shared with them. Shared rows carry the item they were
-- shared through and the sharer's name; own rows say whether they are
-- shared out to anyone.
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
      membership.item_id as shared_root_id, membership.role as access_role
    from public.cloud_memberships as membership
    join public.cloud_items as item on item.id = membership.item_id
    join public.cloud_workspaces as workspace on workspace.id = item.workspace_id
    where membership.user_id = auth.uid()
      and workspace.owner_id <> auth.uid()
      and item.deleted_at is null

    union all

    select child.id, child.workspace_id, child.parent_id, child.kind, child.name, child.root_kind,
      child.created_by, child.created_at, child.updated_at, child.deleted_at,
      shared.shared_root_id, shared.access_role
    from public.cloud_items as child
    join shared on child.parent_id = shared.id
    where child.deleted_at is null
  ), ranked_shared as (
    select distinct on (shared.id) shared.*
    from shared
    order by shared.id, private.cloud_role_rank(shared.access_role) desc
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
    coalesce(profile.display_name, profile.email) as shared_by,
    false as shared_out
  from ranked_shared as ranked
  join public.cloud_workspaces as workspace on workspace.id = ranked.workspace_id
  left join public.cloud_profiles as profile on profile.id = workspace.owner_id
$$;

-- Who an item is shared with, for the owner's Share sheet.
create or replace function public.cloud_item_sharing(target_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := private.cloud_require_owner(target_item_id);
begin
  return jsonb_build_object(
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', membership.user_id,
        'email', profile.email,
        'display_name', profile.display_name,
        'role', membership.role,
        'created_at', membership.created_at
      ) order by membership.created_at)
      from public.cloud_memberships as membership
      left join public.cloud_profiles as profile on profile.id = membership.user_id
      where membership.item_id = target_item_id and membership.user_id <> current_user_id
    ), '[]'::jsonb),
    'invitations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', invitation.id,
        'email', invitation.email,
        'role', invitation.role,
        'created_at', invitation.created_at
      ) order by invitation.created_at)
      from public.cloud_invitations as invitation
      where invitation.item_id = target_item_id
        and invitation.accepted_at is null
        and invitation.revoked_at is null
    ), '[]'::jsonb),
    'links', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', link.id,
        'role', link.role,
        'created_at', link.created_at,
        'expires_at', link.expires_at
      ) order by link.created_at)
      from public.cloud_share_links as link
      where link.item_id = target_item_id
        and link.revoked_at is null
        and (link.expires_at is null or link.expires_at > now())
    ), '[]'::jsonb)
  );
end
$$;

-- The latest durable update per visible document, so a client can tell
-- which closed documents changed without opening them.
create or replace function public.cloud_document_heads(document_ids uuid[])
returns table (document_id uuid, last_update_id bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select document.document_id, coalesce(max(update.id), 0) as last_update_id
  from public.cloud_documents as document
  left join public.cloud_document_updates as update on update.document_id = document.document_id
  where document.document_id = any (document_ids)
    and private.cloud_has_role(document.document_id, 1, auth.uid())
  group by document.document_id
$$;

-- Profile name, for guests and for the Account tab.
create or replace function public.cloud_set_display_name(name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  insert into public.cloud_profiles (id, email, display_name)
  values (current_user_id, auth.jwt() ->> 'email', nullif(btrim(name), ''))
  on conflict (id) do update
  set display_name = excluded.display_name, updated_at = now();
end
$$;

revoke all on function private.cloud_upsert_membership(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function private.cloud_require_owner(uuid) from public, anon, authenticated;
revoke all on function public.cloud_share_item(uuid, text, text) from public, anon;
revoke all on function public.cloud_revoke_access(uuid, uuid, uuid) from public, anon;
revoke all on function public.cloud_accept_invitations() from public, anon;
revoke all on function public.cloud_create_share_link(uuid, text, integer) from public, anon;
revoke all on function public.cloud_revoke_share_link(uuid) from public, anon;
revoke all on function public.cloud_redeem_share_link(text) from public, anon;
revoke all on function public.cloud_leave_item(uuid) from public, anon;
revoke all on function public.cloud_list_visible_items() from public, anon;
revoke all on function public.cloud_item_sharing(uuid) from public, anon;
revoke all on function public.cloud_document_heads(uuid[]) from public, anon;
revoke all on function public.cloud_set_display_name(text) from public, anon;
grant execute on function public.cloud_share_item(uuid, text, text) to authenticated;
grant execute on function public.cloud_revoke_access(uuid, uuid, uuid) to authenticated;
grant execute on function public.cloud_accept_invitations() to authenticated;
grant execute on function public.cloud_create_share_link(uuid, text, integer) to authenticated;
grant execute on function public.cloud_revoke_share_link(uuid) to authenticated;
grant execute on function public.cloud_redeem_share_link(text) to authenticated;
grant execute on function public.cloud_leave_item(uuid) to authenticated;
grant execute on function public.cloud_list_visible_items() to authenticated;
grant execute on function public.cloud_item_sharing(uuid) to authenticated;
grant execute on function public.cloud_document_heads(uuid[]) to authenticated;
grant execute on function public.cloud_set_display_name(text) to authenticated;
