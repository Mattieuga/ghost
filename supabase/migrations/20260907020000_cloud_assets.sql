-- Companion images. A note's `<stem>.assets/` folder on the Mac is mirrored
-- to one private Storage bucket, keyed by the note's Cloud document ID and
-- the file name: `cloud-assets/<document_id>/<file name>`. Access follows
-- the document: anyone who can read the note can fetch its images, anyone
-- who can edit it can add, replace, or remove them.

insert into storage.buckets (id, name, public, file_size_limit)
values ('cloud-assets', 'cloud-assets', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = 26214400;

-- The document an object belongs to, from its path; null for anything odd.
create or replace function private.cloud_asset_document(object_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  if object_name is null or position('/' in object_name) = 0 then
    return null;
  end if;
  return split_part(object_name, '/', 1)::uuid;
exception when others then
  return null;
end
$$;

drop policy if exists "cloud readers can fetch assets" on storage.objects;
create policy "cloud readers can fetch assets"
on storage.objects for select to authenticated
using (
  bucket_id = 'cloud-assets'
  and private.cloud_has_role(private.cloud_asset_document(name), 1, (select auth.uid()))
);

drop policy if exists "cloud editors can add assets" on storage.objects;
create policy "cloud editors can add assets"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'cloud-assets'
  and private.cloud_has_role(private.cloud_asset_document(name), 2, (select auth.uid()))
);

drop policy if exists "cloud editors can replace assets" on storage.objects;
create policy "cloud editors can replace assets"
on storage.objects for update to authenticated
using (
  bucket_id = 'cloud-assets'
  and private.cloud_has_role(private.cloud_asset_document(name), 2, (select auth.uid()))
);

drop policy if exists "cloud editors can remove assets" on storage.objects;
create policy "cloud editors can remove assets"
on storage.objects for delete to authenticated
using (
  bucket_id = 'cloud-assets'
  and private.cloud_has_role(private.cloud_asset_document(name), 2, (select auth.uid()))
);

revoke all on function private.cloud_asset_document(text) from public, anon, authenticated;
