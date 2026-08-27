// @vitest-environment happy-dom

import "fake-indexeddb/auto";
import { Editor } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import StarterKit from "@tiptap/starter-kit";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import {
  cloudLocalPersistenceKey,
  openCloudLocalPersistence,
} from "../src/cloud/cloud-local-persistence";
import {
  AUTOMATIC_VERSION_IDLE_MS,
  AUTOMATIC_VERSION_MAX_INTERVAL_MS,
  AUTOMATIC_VERSION_MIN_INTERVAL_MS,
  automaticVersionDelay,
  automaticVersionMaximumDelay,
  createCloudDocumentVersion,
  listCloudDocumentVersions,
} from "../src/cloud/cloud-version-history";

describe("Cloud reliability helpers", () => {
  it("scopes local recovery data by schema, account, and document", () => {
    expect(cloudLocalPersistenceKey("user-a", "document-a"))
      .toBe("ghost-cloud:v1:user-a:document-a");
    expect(cloudLocalPersistenceKey("user-b", "document-a"))
      .not.toBe(cloudLocalPersistenceKey("user-a", "document-a"));
  });

  it("reloads Yjs edits from local recovery storage", async () => {
    const suffix = crypto.randomUUID();
    const firstDocument = new Y.Doc();
    const first = await openCloudLocalPersistence(
      `user-${suffix}`,
      `document-${suffix}`,
      firstDocument,
    );
    expect(first.status).toBe("ready");
    firstDocument.getText("probe").insert(0, "survives restart");
    await new Promise((resolve) => setTimeout(resolve, 10));
    await first.destroy();
    firstDocument.destroy();

    const reopenedDocument = new Y.Doc();
    const reopened = await openCloudLocalPersistence(
      `user-${suffix}`,
      `document-${suffix}`,
      reopenedDocument,
    );
    expect(reopened.status).toBe("ready");
    expect(reopenedDocument.getText("probe").toString()).toBe("survives restart");

    await reopened.clear();
    reopenedDocument.destroy();
  });

  it("checkpoints after idle time but groups nearby edits", () => {
    const now = Date.parse("2026-08-27T12:00:00Z");
    expect(automaticVersionDelay(null, now)).toBe(AUTOMATIC_VERSION_IDLE_MS);
    expect(automaticVersionDelay("2026-08-27T11:50:00Z", now))
      .toBe(AUTOMATIC_VERSION_IDLE_MS);
    expect(automaticVersionDelay("2026-08-27T11:59:00Z", now))
      .toBe(AUTOMATIC_VERSION_MIN_INTERVAL_MS - 60_000);
    expect(automaticVersionMaximumDelay("2026-08-27T11:59:00Z", now))
      .toBe(AUTOMATIC_VERSION_MAX_INTERVAL_MS - 60_000);
    expect(automaticVersionMaximumDelay("2026-08-27T11:40:00Z", now))
      .toBe(AUTOMATIC_VERSION_IDLE_MS);
  });

  it("loads and creates versions through the narrow Cloud data boundary", async () => {
    const rows = [{
      id: 7,
      document_id: "document-a",
      author_id: "user-a",
      reason: "automatic",
      restored_from_version_id: null,
      markdown_snapshot: "# Saved",
      yjs_snapshot: "AA==",
      created_at: "2026-08-27T12:00:00Z",
    }];
    const limit = vi.fn(async () => ({ data: rows, error: null }));
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      order: vi.fn(() => query),
      limit,
    };
    const rpc = vi.fn(async () => ({ data: rows[0], error: null }));
    const client = {
      from: vi.fn(() => query),
      rpc,
    } as unknown as SupabaseClient;

    await expect(listCloudDocumentVersions(client, "document-a")).resolves.toEqual(rows);
    await expect(createCloudDocumentVersion(client, {
      documentId: "document-a",
      markdownSnapshot: "# Saved",
      yjsSnapshot: "AA==",
      reason: "restore",
      restoredFromVersionId: 3,
    })).resolves.toEqual(rows[0]);
    expect(rpc).toHaveBeenCalledWith("cloud_create_document_version", {
      target_document_id: "document-a",
      snapshot_markdown: "# Saved",
      snapshot_yjs: "AA==",
      version_reason: "restore",
      target_restored_from_version_id: 3,
    });
  });
});

describe("Cloud local undo", () => {
  it("undoes this editor's change without undoing a remote collaborator", () => {
    const aliceDocument = new Y.Doc();
    const alice = new Editor({
      extensions: [
        StarterKit.configure({ undoRedo: false }),
        Collaboration.configure({
          document: aliceDocument,
          field: "default",
          yUndoOptions: { trackedOrigins: [] },
        }),
      ],
    });

    const bobDocument = new Y.Doc();
    Y.applyUpdate(bobDocument, Y.encodeStateAsUpdate(aliceDocument), "remote");
    const bob = new Editor({
      extensions: [
        StarterKit.configure({ undoRedo: false }),
        Collaboration.configure({
          document: bobDocument,
          field: "default",
          yUndoOptions: { trackedOrigins: [] },
        }),
      ],
    });

    alice.commands.insertContent("Alice");
    Y.applyUpdate(
      bobDocument,
      Y.encodeStateAsUpdate(aliceDocument, Y.encodeStateVector(bobDocument)),
      "remote",
    );
    bob.commands.insertContent("Bob");
    Y.applyUpdate(
      aliceDocument,
      Y.encodeStateAsUpdate(bobDocument, Y.encodeStateVector(aliceDocument)),
      "remote",
    );

    expect(alice.getText()).toContain("Alice");
    expect(alice.getText()).toContain("Bob");
    expect(alice.commands.undo()).toBe(true);
    expect(alice.getText()).not.toContain("Alice");
    expect(alice.getText()).toContain("Bob");

    alice.destroy();
    bob.destroy();
    aliceDocument.destroy();
    bobDocument.destroy();
  });
});
