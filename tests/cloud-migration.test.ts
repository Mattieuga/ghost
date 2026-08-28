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
