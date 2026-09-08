-- Live tree updates. Item and membership changes are announced over
-- Realtime broadcast from the database, so a rename on the web reaches the
-- Mac's sidebar at once instead of on the next focus, and a new share
-- reaches the person it was shared with.
--
-- Topics:
--   ghost-tree:<workspace_id>   any item in that workspace changed
--   ghost-user:<user_id>        that user's memberships changed
--
-- `realtime.send` exists on current Supabase projects; the helper swallows
-- its absence so a write never fails because of a notification.

create or replace function private.cloud_notify(topic text, payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(payload, 'changed', topic, true);
exception when others then
  null;
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
begin
  perform private.cloud_notify('ghost-tree:' || workspace::text, jsonb_build_object('item_id', item));
  return null;
end
$$;

drop trigger if exists cloud_items_changed on public.cloud_items;
create trigger cloud_items_changed
after insert or update or delete on public.cloud_items
for each row execute function private.cloud_items_changed();

create or replace function private.cloud_memberships_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  member uuid := coalesce(new.user_id, old.user_id);
  item uuid := coalesce(new.item_id, old.item_id);
  workspace uuid;
begin
  perform private.cloud_notify('ghost-user:' || member::text, jsonb_build_object('item_id', item));
  select workspace_id into workspace from public.cloud_items where id = item;
  if workspace is not null then
    perform private.cloud_notify('ghost-tree:' || workspace::text, jsonb_build_object('item_id', item));
  end if;
  return null;
end
$$;

drop trigger if exists cloud_memberships_changed on public.cloud_memberships;
create trigger cloud_memberships_changed
after insert or update or delete on public.cloud_memberships
for each row execute function private.cloud_memberships_changed();

-- Who may listen: a workspace's owner and anyone with a membership on an
-- item in it, and each user on their own topic.
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
  ) or exists (
    select 1
    from public.cloud_memberships as m
    join public.cloud_items as i on i.id = m.item_id
    where i.workspace_id = workspace and m.user_id = target_user_id
  );
end
$$;

drop policy if exists "cloud members can receive tree events" on realtime.messages;
create policy "cloud members can receive tree events"
on realtime.messages for select to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and private.cloud_can_watch_topic((select realtime.topic()), (select auth.uid()))
);

revoke all on function private.cloud_notify(text, jsonb) from public, anon, authenticated;
revoke all on function private.cloud_items_changed() from public, anon, authenticated;
revoke all on function private.cloud_memberships_changed() from public, anon, authenticated;
revoke all on function private.cloud_can_watch_topic(text, uuid) from public, anon, authenticated;
