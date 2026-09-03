-- One share link per item, like a Google Doc: off, anyone can view, or
-- anyone can edit. The owner can copy the same link again at any time, so
-- the token is kept alongside its hash and returned only through the
-- owner-only sharing summary. Redeeming still looks up by hash.

alter table public.cloud_share_links
  add column if not exists token text;

-- Links from before this change have no token to show; they end here and
-- the owner turns the link back on to get one.
update public.cloud_share_links
set revoked_at = now()
where token is null and revoked_at is null;

create unique index if not exists cloud_share_links_one_active
on public.cloud_share_links (item_id)
where revoked_at is null;

drop function if exists public.cloud_create_share_link(uuid, text, integer);
drop function if exists public.cloud_revoke_share_link(uuid);

-- Turn the item's link off (null role), or on at a role. Turning it on when
-- it is already on only changes the role; the link itself stays the same.
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
  return jsonb_build_object(
    'id', link.id,
    'role', link.role,
    'token', link.token,
    'created_at', link.created_at
  );
end
$$;

-- The owner's sharing summary now carries the one link, token included.
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
    'link', (
      select jsonb_build_object(
        'id', link.id,
        'role', link.role,
        'token', link.token,
        'created_at', link.created_at
      )
      from public.cloud_share_links as link
      where link.item_id = target_item_id
        and link.revoked_at is null
        and link.token is not null
        and (link.expires_at is null or link.expires_at > now())
      limit 1
    )
  );
end
$$;

revoke all on function public.cloud_set_share_link(uuid, text) from public, anon;
revoke all on function public.cloud_item_sharing(uuid) from public, anon;
grant execute on function public.cloud_set_share_link(uuid, text) to authenticated;
grant execute on function public.cloud_item_sharing(uuid) to authenticated;
