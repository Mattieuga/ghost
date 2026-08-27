-- Preserve shared items and memberships when the user recorded in an audit
-- column deletes their account. Ownership still cascades through workspaces;
-- these two references describe who performed an action, not who owns it.

alter table public.cloud_items
  alter column created_by drop not null,
  drop constraint cloud_items_created_by_fkey,
  add constraint cloud_items_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete set null;

alter table public.cloud_memberships
  alter column granted_by drop not null,
  drop constraint cloud_memberships_granted_by_fkey,
  add constraint cloud_memberships_granted_by_fkey
    foreign key (granted_by) references auth.users(id) on delete set null;
