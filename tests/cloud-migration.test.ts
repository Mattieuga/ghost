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
});
