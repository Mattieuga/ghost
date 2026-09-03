-- Synced folders (ADR 0005, Phase 2). Documents and folders are created on
-- the client first, so the server accepts client-supplied IDs idempotently,
-- adopts a whole subtree in one transaction, can move items, anchors the
-- Notes root explicitly, and accepts local version history in a batch.

-- Root anchors -------------------------------------------------------------

alter table public.cloud_items
  add column if not exists root_kind text
  check (root_kind in ('notes', 'folder'));

alter table public.cloud_items
  drop constraint if exists cloud_items_root_kind_top_level;
alter table public.cloud_items
  add constraint cloud_items_root_kind_top_level
  check (root_kind is null or parent_id is null);

create unique index if not exists cloud_items_one_notes_root
on public.cloud_items (workspace_id)
where root_kind = 'notes' and deleted_at is null;

-- Name helpers -------------------------------------------------------------

create or replace function private.cloud_numbered_name(base_name text, attempt integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when lower(base_name) like '%.md'
      then left(base_name, char_length(base_name) - 3) || ' ' || attempt || '.md'
    else base_name || ' ' || attempt
  end
$$;

-- Idempotent insert shared by single create and batch adopt ----------------

create or replace function private.cloud_insert_item(
  acting_user_id uuid,
  target_item_id uuid,
  item_kind text,
  item_name text,
  target_parent_id uuid,
  target_root_kind text,
  rename_on_conflict boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.cloud_items;
  target_workspace public.cloud_workspaces;
  normalized_name text := btrim(coalesce(item_name, ''));
  candidate_name text;
  attempt integer := 1;
  result public.cloud_items;
begin
  if acting_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if item_kind not in ('folder', 'document') then
    raise exception 'Unsupported Cloud item type';
  end if;
  if normalized_name = '' or char_length(normalized_name) > 255
    or position('/' in normalized_name) > 0 then
    raise exception 'Invalid Cloud item name';
  end if;
  if item_kind = 'document' and lower(normalized_name) not like '%.md' then
    normalized_name := normalized_name || '.md';
  end if;
  if target_root_kind is not null then
    if target_root_kind not in ('notes', 'folder') then
      raise exception 'Unsupported Cloud root kind';
    end if;
    if target_parent_id is not null or item_kind <> 'folder' then
      raise exception 'Root kinds apply only to top-level folders';
    end if;
  end if;

  if target_item_id is not null then
    if target_item_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'Invalid Cloud item ID';
    end if;
    select * into existing from public.cloud_items where id = target_item_id;
    if existing.id is not null then
      -- A retried upload. The same editor gets the same row back.
      if existing.deleted_at is null
        and private.cloud_has_role(existing.id, 2, acting_user_id) then
        return jsonb_build_object('item', to_jsonb(existing), 'outcome', 'existing');
      end if;
      raise exception 'Cloud item ID is already in use' using errcode = '23505';
    end if;
  end if;

  if target_parent_id is null then
    select workspace.* into target_workspace
    from public.cloud_workspaces as workspace
    where workspace.owner_id = acting_user_id;
    if target_workspace.id is null then
      raise exception 'Cloud workspace not found';
    end if;
  else
    select workspace.* into target_workspace
    from public.cloud_items as parent
    join public.cloud_workspaces as workspace on workspace.id = parent.workspace_id
    where parent.id = target_parent_id
      and parent.kind = 'folder'
      and parent.deleted_at is null;
    if target_workspace.id is null
      or not private.cloud_has_role(target_parent_id, 2, acting_user_id) then
      raise exception 'Cloud parent is not editable' using errcode = '42501';
    end if;
  end if;

  if target_root_kind = 'notes' and exists (
    select 1 from public.cloud_items as root
    where root.workspace_id = target_workspace.id
      and root.root_kind = 'notes'
      and root.deleted_at is null
  ) then
    raise exception 'This Cloud already has a Notes root' using errcode = '23505';
  end if;

  candidate_name := normalized_name;
  loop
    begin
      insert into public.cloud_items (
        id, workspace_id, parent_id, kind, name, created_by, root_kind
      ) values (
        coalesce(target_item_id, gen_random_uuid()),
        target_workspace.id,
        target_parent_id,
        item_kind,
        candidate_name,
        acting_user_id,
        target_root_kind
      ) returning * into result;
      exit;
    exception
      when unique_violation then
        if not rename_on_conflict or attempt >= 100 then
          raise exception 'A Cloud item with that name already exists' using errcode = '23505';
        end if;
        attempt := attempt + 1;
        candidate_name := private.cloud_numbered_name(normalized_name, attempt);
    end;
  end loop;

  if item_kind = 'document' then
    insert into public.cloud_documents (document_id) values (result.id);
  end if;

  return jsonb_build_object(
    'item', to_jsonb(result),
    'outcome', case when candidate_name = normalized_name then 'created' else 'renamed' end
  );
end
$$;

-- Single create, now with an optional client ID and root kind -------------

drop function if exists public.cloud_create_item(text, text, uuid);
create function public.cloud_create_item(
  item_kind text,
  item_name text,
  target_parent_id uuid default null,
  target_item_id uuid default null,
  target_root_kind text default null
)
returns public.cloud_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  payload jsonb;
begin
  payload := private.cloud_insert_item(
    auth.uid(), target_item_id, item_kind, item_name, target_parent_id, target_root_kind, false
  );
  return jsonb_populate_record(null::public.cloud_items, payload -> 'item');
end
$$;

-- Batch adopt: a client-built subtree, parents first, all or nothing -------

create or replace function public.cloud_adopt_items(items jsonb)
returns setof jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  entry jsonb;
  payload jsonb;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if items is null or jsonb_typeof(items) <> 'array' then
    raise exception 'Items must be an array';
  end if;
  if jsonb_array_length(items) > 500 then
    raise exception 'Adopt at most 500 items per call';
  end if;

  for entry in select * from jsonb_array_elements(items) loop
    payload := private.cloud_insert_item(
      current_user_id,
      (entry ->> 'id')::uuid,
      entry ->> 'kind',
      entry ->> 'name',
      (entry ->> 'parent_id')::uuid,
      entry ->> 'root_kind',
      true
    );
    return next payload || jsonb_build_object('requested_name', entry ->> 'name');
  end loop;
  return;
end
$$;

-- Move ---------------------------------------------------------------------

create or replace function public.cloud_move_item(
  target_item_id uuid,
  target_parent_id uuid default null
)
returns public.cloud_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  item public.cloud_items;
  destination public.cloud_items;
  result public.cloud_items;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select * into item from public.cloud_items
  where id = target_item_id and deleted_at is null;
  if item.id is null then
    raise exception 'Cloud item not found';
  end if;
  if not private.cloud_has_role(target_item_id, 2, current_user_id) then
    raise exception 'Cloud item is not editable' using errcode = '42501';
  end if;
  if item.root_kind is not null then
    raise exception 'A root folder cannot be moved';
  end if;

  if target_parent_id is null then
    if not exists (
      select 1 from public.cloud_workspaces as workspace
      where workspace.id = item.workspace_id and workspace.owner_id = current_user_id
    ) then
      raise exception 'Only the owner can move items to the top level' using errcode = '42501';
    end if;
  else
    select * into destination from public.cloud_items
    where id = target_parent_id and deleted_at is null and kind = 'folder';
    if destination.id is null
      or destination.workspace_id <> item.workspace_id
      or not private.cloud_has_role(target_parent_id, 2, current_user_id) then
      raise exception 'Cloud destination is not editable' using errcode = '42501';
    end if;
    if target_parent_id = target_item_id or exists (
      with recursive descendants as (
        select child.id
        from public.cloud_items as child
        where child.parent_id = target_item_id and child.deleted_at is null
        union
        select child.id
        from public.cloud_items as child
        join descendants on descendants.id = child.parent_id
        where child.deleted_at is null
      )
      select 1 from descendants where descendants.id = target_parent_id
    ) then
      raise exception 'A folder cannot be moved inside itself';
    end if;
  end if;

  update public.cloud_items
  set parent_id = target_parent_id, updated_at = now()
  where id = target_item_id
  returning * into result;
  return result;
exception
  when unique_violation then
    raise exception 'A Cloud item with that name already exists' using errcode = '23505';
end
$$;

-- Versions: external_write reason and batch upload of local history --------

alter table public.cloud_document_versions
  drop constraint if exists cloud_document_versions_reason_check;
alter table public.cloud_document_versions
  add constraint cloud_document_versions_reason_check
  check (reason in ('automatic', 'restore', 'restore_backup', 'external_write'));

create or replace function public.cloud_create_document_version(
  target_document_id uuid,
  snapshot_markdown text,
  snapshot_yjs text,
  version_reason text default 'automatic',
  target_restored_from_version_id bigint default null
)
returns public.cloud_document_versions
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  latest public.cloud_document_versions;
  result public.cloud_document_versions;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not private.cloud_has_role(target_document_id, 2, current_user_id) then
    raise exception 'Cloud document is not editable' using errcode = '42501';
  end if;
  if version_reason not in ('automatic', 'restore', 'restore_backup', 'external_write') then
    raise exception 'Unsupported document version reason';
  end if;
  if octet_length(snapshot_markdown) > 5242880 then
    raise exception 'Markdown snapshot is too large';
  end if;
  if snapshot_yjs !~ '^[A-Za-z0-9+/]*={0,2}$'
    or octet_length(decode(snapshot_yjs, 'base64')) > 10485760 then
    raise exception 'Yjs snapshot is invalid or too large';
  end if;
  if target_restored_from_version_id is not null and not exists (
    select 1
    from public.cloud_document_versions as version
    where version.id = target_restored_from_version_id
      and version.document_id = target_document_id
  ) then
    raise exception 'Restored version does not belong to this document';
  end if;

  perform pg_advisory_xact_lock(hashtext(target_document_id::text));
  select version.* into latest
  from public.cloud_document_versions as version
  where version.document_id = target_document_id
  order by version.created_at desc, version.id desc
  limit 1;

  if latest.id is not null then
    if latest.markdown_snapshot = snapshot_markdown then
      return latest;
    end if;
    if version_reason = 'automatic'
      and latest.created_at > now() - interval '5 minutes' then
      return latest;
    end if;
  end if;

  insert into public.cloud_document_versions (
    document_id,
    author_id,
    reason,
    restored_from_version_id,
    markdown_snapshot,
    yjs_snapshot
  ) values (
    target_document_id,
    current_user_id,
    version_reason,
    target_restored_from_version_id,
    snapshot_markdown,
    snapshot_yjs
  ) returning * into result;

  update public.cloud_documents
  set markdown_snapshot = snapshot_markdown,
      snapshot_updated_at = result.created_at,
      updated_at = result.created_at
  where document_id = target_document_id;

  return result;
end
$$;

create or replace function public.cloud_upload_document_versions(
  target_document_id uuid,
  versions jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  entry jsonb;
  entry_reason text;
  entry_created_at timestamptz;
  entry_markdown text;
  entry_yjs text;
  inserted integer := 0;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not private.cloud_has_role(target_document_id, 2, current_user_id) then
    raise exception 'Cloud document is not editable' using errcode = '42501';
  end if;
  if versions is null or jsonb_typeof(versions) <> 'array' then
    raise exception 'Versions must be an array';
  end if;
  if jsonb_array_length(versions) > 100 then
    raise exception 'Upload at most 100 versions per call';
  end if;

  perform pg_advisory_xact_lock(hashtext(target_document_id::text));

  for entry in select * from jsonb_array_elements(versions) loop
    entry_reason := coalesce(entry ->> 'reason', 'automatic');
    entry_created_at := (entry ->> 'created_at')::timestamptz;
    entry_markdown := entry ->> 'markdown';
    entry_yjs := entry ->> 'yjs';
    if entry_reason not in ('automatic', 'restore', 'restore_backup', 'external_write') then
      raise exception 'Unsupported document version reason';
    end if;
    if entry_created_at is null or entry_markdown is null or entry_yjs is null then
      raise exception 'Invalid document version entry';
    end if;
    if octet_length(entry_markdown) > 5242880 then
      raise exception 'Markdown snapshot is too large';
    end if;
    if entry_yjs !~ '^[A-Za-z0-9+/]*={0,2}$'
      or octet_length(decode(entry_yjs, 'base64')) > 10485760 then
      raise exception 'Yjs snapshot is invalid or too large';
    end if;
    if exists (
      select 1 from public.cloud_document_versions as version
      where version.document_id = target_document_id
        and version.created_at = entry_created_at
        and version.markdown_snapshot = entry_markdown
    ) then
      continue;
    end if;

    insert into public.cloud_document_versions (
      document_id, author_id, reason, markdown_snapshot, yjs_snapshot, created_at
    ) values (
      target_document_id, current_user_id, entry_reason, entry_markdown, entry_yjs, entry_created_at
    );
    inserted := inserted + 1;
  end loop;

  update public.cloud_documents as document
  set markdown_snapshot = latest.markdown_snapshot,
      snapshot_updated_at = latest.created_at,
      updated_at = now()
  from (
    select version.markdown_snapshot, version.created_at
    from public.cloud_document_versions as version
    where version.document_id = target_document_id
    order by version.created_at desc, version.id desc
    limit 1
  ) as latest
  where document.document_id = target_document_id
    and (document.snapshot_updated_at is null or document.snapshot_updated_at < latest.created_at);

  return inserted;
end
$$;

-- Grants -------------------------------------------------------------------

revoke all on function private.cloud_numbered_name(text, integer) from public, anon, authenticated;
revoke all on function private.cloud_insert_item(uuid, uuid, text, text, uuid, text, boolean)
from public, anon, authenticated;

revoke all on function public.cloud_create_item(text, text, uuid, uuid, text) from public, anon;
revoke all on function public.cloud_adopt_items(jsonb) from public, anon;
revoke all on function public.cloud_move_item(uuid, uuid) from public, anon;
revoke all on function public.cloud_upload_document_versions(uuid, jsonb) from public, anon;
grant execute on function public.cloud_create_item(text, text, uuid, uuid, text) to authenticated;
grant execute on function public.cloud_adopt_items(jsonb) to authenticated;
grant execute on function public.cloud_move_item(uuid, uuid) to authenticated;
grant execute on function public.cloud_upload_document_versions(uuid, jsonb) to authenticated;
