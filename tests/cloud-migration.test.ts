import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../supabase/migrations/20260826010000_cloud_foundation.sql", import.meta.url),
  "utf8",
);
const accountDeletionMigration = readFileSync(
  new URL("../supabase/migrations/20260827010000_cloud_account_deletion.sql", import.meta.url),
  "utf8",
);
const documentVersionsMigration = readFileSync(
  new URL("../supabase/migrations/20260827020000_cloud_document_versions.sql", import.meta.url),
  "utf8",
);
const itemMutationsMigration = readFileSync(
  new URL("../supabase/migrations/20260828010000_cloud_item_mutations.sql", import.meta.url),
  "utf8",
);
const syncedFoldersMigration = readFileSync(
  new URL("../supabase/migrations/20260902010000_cloud_synced_folders.sql", import.meta.url),
  "utf8",
);
const sharingMigration = readFileSync(
  new URL("../supabase/migrations/20260902020000_cloud_sharing.sql", import.meta.url),
  "utf8",
);
const hardeningMigration = readFileSync(
  new URL("../supabase/migrations/20260903010000_cloud_review_hardening.sql", import.meta.url),
  "utf8",
);

describe("Cloud foundation migration", () => {
  it("keeps retained Cloud tables separate from the disposable spike", () => {
    expect(migration).toContain("public.cloud_items");
    expect(migration).toContain("public.cloud_document_updates");
    expect(migration).not.toContain("references public.collaboration_spike");
  });

  it("enables RLS and revokes default client grants on every exposed table", () => {
    for (const table of [
      "cloud_profiles",
      "cloud_workspaces",
      "cloud_items",
      "cloud_memberships",
      "cloud_documents",
      "cloud_document_updates",
    ]) {
      expect(migration).toContain(`alter table public.${table} enable row level security`);
      expect(migration).toContain(`revoke all on public.${table} from anon, authenticated`);
    }
  });

  it("pins search paths on every privileged helper", () => {
    const definerFunctions = migration.split("security definer").slice(1);
    expect(definerFunctions.length).toBeGreaterThanOrEqual(7);
    for (const functionBody of definerFunctions) {
      expect(functionBody.slice(0, 120)).toContain("set search_path = ''");
    }
  });

  it("allows only editors to append durable updates and realtime messages", () => {
    expect(migration).toContain("cloud editors can append updates");
    expect(migration).toContain("private.cloud_has_role(document_id, 2");
    expect(migration).toContain("cloud editors can send realtime");
    expect(migration).toContain("private.cloud_topic_document_id");
  });

  it("does not let audit references block account deletion", () => {
    expect(accountDeletionMigration).toContain("cloud_items_created_by_fkey");
    expect(accountDeletionMigration).toContain("cloud_memberships_granted_by_fkey");
    expect(accountDeletionMigration.match(/on delete set null/g)).toHaveLength(2);
  });

  it("protects restorable document versions behind inherited document access", () => {
    expect(documentVersionsMigration).toContain("public.cloud_document_versions");
    expect(documentVersionsMigration).toContain(
      "alter table public.cloud_document_versions enable row level security",
    );
    expect(documentVersionsMigration).toContain(
      "revoke all on public.cloud_document_versions from anon, authenticated",
    );
    expect(documentVersionsMigration).toContain("private.cloud_has_role(target_document_id, 2");
    expect(documentVersionsMigration).toContain("private.cloud_has_role(document_id, 1");
    expect(documentVersionsMigration).toContain("security definer\nset search_path = ''");
    expect(documentVersionsMigration).toContain("octet_length(snapshot_markdown) > 5242880");
    expect(documentVersionsMigration).toContain("octet_length(decode(snapshot_yjs, 'base64')) > 10485760");
    expect(documentVersionsMigration).toContain("latest.created_at > now() - interval '5 minutes'");
  });

  it("keeps shared sidebar mutations behind inherited editor access", () => {
    expect(itemMutationsMigration).toContain("public.cloud_duplicate_item");
    expect(itemMutationsMigration).toContain("public.cloud_trash_item");
    expect(itemMutationsMigration.match(/private\.cloud_has_role\(target_item_id, 2/g)).toHaveLength(2);
    expect(itemMutationsMigration).toContain("with recursive descendants");
    expect(itemMutationsMigration).toContain("private.cloud_duplicate_item_recursive");
    expect(itemMutationsMigration).toContain(
      "revoke all on function private.cloud_duplicate_item_recursive",
    );
    expect(itemMutationsMigration.match(/security definer\nset search_path = ''/g)).toHaveLength(3);
  });
});

describe("Synced folders migration", () => {
  it("accepts client IDs idempotently and only for editors of the existing row", () => {
    expect(syncedFoldersMigration).toContain("drop function if exists public.cloud_create_item(text, text, uuid)");
    expect(syncedFoldersMigration).toContain("target_item_id uuid default null");
    expect(syncedFoldersMigration).toContain("'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'");
    expect(syncedFoldersMigration).toContain("private.cloud_has_role(existing.id, 2, acting_user_id)");
    expect(syncedFoldersMigration).toContain("'outcome', 'existing'");
    expect(syncedFoldersMigration).toContain("coalesce(target_item_id, gen_random_uuid())");
  });

  it("adopts a subtree in one transaction with server-side renames on collision", () => {
    expect(syncedFoldersMigration).toContain("public.cloud_adopt_items(items jsonb)");
    expect(syncedFoldersMigration).toContain("jsonb_array_length(items) > 500");
    expect(syncedFoldersMigration).toContain("private.cloud_numbered_name(normalized_name, attempt)");
    expect(syncedFoldersMigration).toContain("'requested_name', entry ->> 'name'");
  });

  it("moves items only between editable folders of one workspace and never into themselves", () => {
    expect(syncedFoldersMigration).toContain("public.cloud_move_item(");
    expect(syncedFoldersMigration).toContain("destination.workspace_id <> item.workspace_id");
    expect(syncedFoldersMigration).toContain("with recursive descendants");
    expect(syncedFoldersMigration).toContain("A folder cannot be moved inside itself");
    expect(syncedFoldersMigration).toContain("A root folder cannot be moved");
  });

  it("anchors one Notes root per workspace at the top level", () => {
    expect(syncedFoldersMigration).toContain("root_kind in ('notes', 'folder')");
    expect(syncedFoldersMigration).toContain("check (root_kind is null or parent_id is null)");
    expect(syncedFoldersMigration).toContain("where root_kind = 'notes' and deleted_at is null");
  });

  it("uploads local history in a batch behind editor access with the external_write reason", () => {
    expect(syncedFoldersMigration).toContain("reason in ('automatic', 'restore', 'restore_backup', 'external_write')");
    expect(syncedFoldersMigration).toContain("public.cloud_upload_document_versions(");
    expect(syncedFoldersMigration).toContain("jsonb_array_length(versions) > 100");
    expect(syncedFoldersMigration).toContain("pg_advisory_xact_lock(hashtext(target_document_id::text))");
    expect(syncedFoldersMigration.match(/private\.cloud_has_role\(target_document_id, 2, current_user_id\)/g)).toHaveLength(2);
  });

  it("keeps the security shape of every new function", () => {
    expect(syncedFoldersMigration.match(/security definer\nset search_path = ''/g)).toHaveLength(6);
    for (const signature of [
      "public.cloud_create_item(text, text, uuid, uuid, text)",
      "public.cloud_adopt_items(jsonb)",
      "public.cloud_move_item(uuid, uuid)",
      "public.cloud_upload_document_versions(uuid, jsonb)",
    ]) {
      expect(syncedFoldersMigration).toContain(`revoke all on function ${signature} from public, anon`);
      expect(syncedFoldersMigration).toContain(`grant execute on function ${signature} to authenticated`);
    }
    expect(syncedFoldersMigration).toContain(
      "revoke all on function private.cloud_insert_item(uuid, uuid, text, text, uuid, text, boolean)\nfrom public, anon, authenticated",
    );
  });
});

describe("Sharing migration", () => {
  it("stores only token hashes and returns the raw token once", () => {
    expect(sharingMigration).toContain("token_hash text not null unique");
    expect(sharingMigration).not.toMatch(/\n\s+token text/);
    expect(sharingMigration).toContain("encode(extensions.digest(raw_token, 'sha256'), 'hex')");
    expect(sharingMigration).toContain("'token', raw_token");
    expect(sharingMigration).toContain("and (expires_at is null or expires_at > now())");
  });

  it("keeps link and invitation tables behind RPCs with RLS on", () => {
    for (const table of ["cloud_share_links", "cloud_invitations"]) {
      expect(sharingMigration).toContain(`alter table public.${table} enable row level security`);
      expect(sharingMigration).toContain(`revoke all on public.${table} from anon, authenticated`);
    }
    expect(sharingMigration).not.toContain("grant select on public.cloud_share_links");
  });

  it("lets only owners with permanent accounts share, and keeps the higher role on redeem", () => {
    expect(sharingMigration).toContain("if not private.cloud_has_role(target_item_id, 3, current_user_id) then");
    expect(sharingMigration).toContain("raise exception 'A permanent account is required'");
    expect(sharingMigration).toMatch(/private\.cloud_role_rank\(excluded\.role\) > private\.cloud_role_rank\(public\.cloud_memberships\.role\)/);
    expect(sharingMigration).toContain("if owner_id <> current_user_id then");
  });

  it("attaches invitations by the signed-in email and never for guests", () => {
    expect(sharingMigration).toContain("where lower(inv.email) = current_email");
    expect(sharingMigration).toMatch(/cloud_accept_invitations\(\)[\s\S]*is_anonymous[\s\S]*return 0;/);
    expect(sharingMigration).toContain("create unique index if not exists cloud_invitations_pending");
  });

  it("lists own items with shared_out and shared subtrees with their sharer", () => {
    expect(sharingMigration).toContain("membership.item_id as shared_root_id");
    expect(sharingMigration).toContain("where workspace.owner_id = auth.uid() and item.deleted_at is null");
    expect(sharingMigration).toContain("coalesce(profile.display_name, profile.email) as shared_by");
    expect(sharingMigration).toContain("select distinct on (shared.id) shared.*");
  });

  it("keeps the security shape of every new function", () => {
    expect(sharingMigration.match(/security definer\nset search_path = ''/g)).toHaveLength(13);
    for (const signature of [
      "public.cloud_share_item(uuid, text, text)",
      "public.cloud_revoke_access(uuid, uuid, uuid)",
      "public.cloud_accept_invitations()",
      "public.cloud_create_share_link(uuid, text, integer)",
      "public.cloud_revoke_share_link(uuid)",
      "public.cloud_redeem_share_link(text)",
      "public.cloud_leave_item(uuid)",
      "public.cloud_list_visible_items()",
      "public.cloud_item_sharing(uuid)",
      "public.cloud_document_heads(uuid[])",
      "public.cloud_set_display_name(text)",
    ]) {
      expect(sharingMigration).toContain(`revoke all on function ${signature} from public, anon`);
      expect(sharingMigration).toContain(`grant execute on function ${signature} to authenticated`);
    }
    for (const helper of [
      "private.cloud_upsert_membership(uuid, uuid, text, uuid)",
      "private.cloud_require_owner(uuid)",
    ]) {
      expect(sharingMigration).toContain(`revoke all on function ${helper} from public, anon, authenticated`);
    }
  });
});

describe("Review hardening migration", () => {
  it("requires edit rights on the destination when duplicating", () => {
    expect(hardeningMigration).toContain("raise exception 'Only the owner can duplicate a top-level item'");
    expect(hardeningMigration).toContain("elsif not private.cloud_has_role(source_item.parent_id, 2, current_user_id) then");
  });

  it("keeps synced roots with their owner for rename and trash", () => {
    expect(hardeningMigration).toContain("raise exception 'Only the owner can change a synced root'");
    expect(hardeningMigration.match(/perform private\.cloud_require_root_owner\(target_item_id, /g)).toHaveLength(2);
  });

  it("assigns update ids under a per-document lock, in commit order", () => {
    expect(hardeningMigration).toContain("perform pg_advisory_xact_lock(hashtext(new.document_id::text));");
    expect(hardeningMigration).toContain("new.id := nextval(pg_get_serial_sequence('public.cloud_document_updates', 'id'));");
    expect(hardeningMigration).toContain("before insert on public.cloud_document_updates");
  });

  it("names guests, hides the sharer's address, and resolves one shared root per item", () => {
    expect(hardeningMigration).toContain("auth.jwt() -> 'user_metadata' ->> 'display_name'");
    expect(hardeningMigration).toContain("split_part(profile.email, '@', 1)");
    expect(hardeningMigration).not.toContain("coalesce(profile.display_name, profile.email)");
    expect(hardeningMigration).toContain("shared.depth desc, shared.shared_root_id");
  });

  it("attaches invitations only to confirmed addresses and clamps version times", () => {
    expect(hardeningMigration).toContain("account.email_confirmed_at is not null");
    expect(hardeningMigration).toContain("new.created_at := least(new.created_at, now());");
  });

  it("keeps the security shape of every function it replaces", () => {
    expect(hardeningMigration.match(/security definer\nset search_path = ''/g)).toHaveLength(9);
    for (const signature of [
      "public.cloud_duplicate_item(uuid)",
      "public.cloud_rename_item(uuid, text)",
      "public.cloud_trash_item(uuid)",
      "public.cloud_redeem_share_link(text)",
      "public.cloud_list_visible_items()",
      "public.cloud_accept_invitations()",
    ]) {
      expect(hardeningMigration).toContain(`revoke all on function ${signature} from public, anon`);
      expect(hardeningMigration).toContain(`grant execute on function ${signature} to authenticated`);
    }
    for (const helper of [
      "private.cloud_require_root_owner(uuid, uuid)",
      "private.cloud_order_document_updates()",
      "private.cloud_clamp_version_time()",
    ]) {
      expect(hardeningMigration).toContain(`revoke all on function ${helper} from public, anon, authenticated`);
    }
  });
});
