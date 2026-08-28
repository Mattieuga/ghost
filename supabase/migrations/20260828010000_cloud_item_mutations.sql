-- Cloud tree mutations used by the shared Workspace/Cloud sidebar controls.

create or replace function private.cloud_duplicate_item_recursive(
  source_item_id uuid,
  target_parent_id uuid,
  target_name text,
  acting_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_item public.cloud_items;
  child public.cloud_items;
  new_item public.cloud_items;
  duplicate_client_id uuid := gen_random_uuid();
begin
  select * into source_item
  from public.cloud_items
  where id = source_item_id and deleted_at is null;

  if source_item.id is null then
    raise exception 'Cloud item not found';
  end if;

  insert into public.cloud_items (
    workspace_id, parent_id, kind, name, created_by
  ) values (
    source_item.workspace_id, target_parent_id, source_item.kind, target_name, acting_user_id
  ) returning * into new_item;

  if source_item.kind = 'document' then
    insert into public.cloud_documents (
      document_id, schema_version, markdown_snapshot, snapshot_updated_at
    )
    select new_item.id, schema_version, markdown_snapshot, snapshot_updated_at
    from public.cloud_documents
    where document_id = source_item.id;

    insert into public.cloud_document_updates (
      document_id, author_id, client_id, client_sequence, update
    )
    select
      new_item.id,
      acting_user_id,
      duplicate_client_id,
      row_number() over (order by original.id),
      original.update
    from public.cloud_document_updates as original
    where original.document_id = source_item.id
    order by original.id;
  else
    for child in
      select *
      from public.cloud_items
      where parent_id = source_item.id and deleted_at is null
      order by kind, lower(name)
    loop
      perform private.cloud_duplicate_item_recursive(
        child.id,
        new_item.id,
        child.name,
        acting_user_id
      );
    end loop;
  end if;

  return new_item.id;
end
$$;

create or replace function public.cloud_duplicate_item(target_item_id uuid)
returns public.cloud_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  source_item public.cloud_items;
  candidate_name text;
  stem text;
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

revoke all on function private.cloud_duplicate_item_recursive(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.cloud_duplicate_item(uuid) from public, anon;
revoke all on function public.cloud_trash_item(uuid) from public, anon;
grant execute on function public.cloud_duplicate_item(uuid) to authenticated;
grant execute on function public.cloud_trash_item(uuid) to authenticated;
