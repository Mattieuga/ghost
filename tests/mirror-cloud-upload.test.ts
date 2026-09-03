// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { seedDocumentFromMarkdown, writeGhostFolderMetadata, writeGhostIndex } from "../src/lib/mirror/adoption";
import { isMissingServerFunction, uploadMirroredRoot } from "../src/lib/mirror/cloud-upload";
import { emptyGhostIndex } from "../src/lib/mirror/ghost-index";
import type { MirrorFs } from "../src/lib/mirror/mirror-fs";
import type { TrackedRoot } from "../src/hooks/use-tracked-folders";

function memoryFs(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const fs = {
    readText: async (path: string) => {
      const text = files.get(path);
      if (text === undefined) throw new Error(`missing ${path}`);
      return text;
    },
    writeText: async (path: string, content: string) => {
      files.set(path, content);
      return { canonical_path: path, size_bytes: content.length, modified_ns: "1", device_id: null, file_id: null };
    },
    ensureDir: async () => undefined,
    listFiles: async (dir: string) => Array.from(files.keys())
      .filter((path) => path.startsWith(`${dir}/`) && !path.slice(dir.length + 1).includes("/"))
      .map((path) => path.slice(dir.length + 1)),
  } as unknown as MirrorFs;
  return { fs, files };
}

function fakeClient() {
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "cloud_upload_document_versions") {
      return { data: (args.versions as unknown[]).length, error: null };
    }
    return { data: [], error: null };
  });
  const upsert = vi.fn(async () => ({ error: null }));
  const client = { rpc, from: () => ({ upsert }) } as unknown as SupabaseClient;
  return { client, rpc, upsert };
}

const ROOT: TrackedRoot = { id: "11111111-1111-4111-8111-111111111111", path: "/Users/me/Ghost/Notes", kind: "mirrored" };

describe("uploadMirroredRoot", () => {
  it("creates the tree parents first, pushes each document's state, sends history, and records the Cloud ID", async () => {
    const { fs, files } = memoryFs();
    const index = emptyGhostIndex();
    index.documents["plan.md"] = { documentId: "22222222-2222-4222-8222-222222222222", contentHash: "h", mirrorVersion: null, mirrorStateVector: null };
    index.documents["deep/inner/notes.md"] = { documentId: "33333333-3333-4333-8333-333333333333", contentHash: "h", mirrorVersion: null, mirrorStateVector: null };
    await writeGhostIndex(fs, ROOT.path, index);
    files.set(`${ROOT.path}/.ghost/versions/22222222-2222-4222-8222-222222222222/2026-09-02T10-00-00.000Z-automatic.md`, "# Plan\n");
    files.set(`${ROOT.path}/.ghost/versions/22222222-2222-4222-8222-222222222222/2026-09-02T10-00-00.000Z-automatic.yjs`, "AAA=");

    const stores = new Map<string, Uint8Array>();
    const seeded = new Y.Doc();
    seedDocumentFromMarkdown(seeded, "# Plan\n");
    stores.set("22222222-2222-4222-8222-222222222222", Y.encodeStateAsUpdate(seeded));

    const { client, rpc, upsert } = fakeClient();
    let ids = 0;
    const result = await uploadMirroredRoot({
      client,
      fs,
      ghostFolder: "/Users/me/Ghost",
      newId: () => `f${++ids}`,
      openPersistence: async (_rootId, documentId, document) => {
        const saved = stores.get(documentId);
        if (saved) Y.applyUpdate(document, saved);
        return { status: "ready", destroy: async () => undefined };
      },
    }, ROOT);

    expect(result).toEqual({ cloudRootId: ROOT.id, documents: 2, versions: 1, alreadyUploaded: false });

    const adopt = rpc.mock.calls.find((call) => call[0] === "cloud_adopt_items");
    const items = (adopt?.[1] as { items: Array<Record<string, unknown>> }).items;
    expect(items.map((item) => [item.kind, item.name, item.parent_id])).toEqual([
      ["folder", "Notes", null],
      ["folder", "deep", ROOT.id],
      ["folder", "inner", "f1"],
      ["document", "notes.md", "f2"],
      ["document", "plan.md", ROOT.id],
    ]);
    expect(items[0].root_kind).toBe("notes");
    expect(items[0].id).toBe(ROOT.id);

    // One state update for the document that had content; the empty one is skipped.
    expect(upsert).toHaveBeenCalledTimes(1);
    expect((upsert.mock.calls[0][0] as Record<string, unknown>).document_id).toBe("22222222-2222-4222-8222-222222222222");

    const versions = rpc.mock.calls.find((call) => call[0] === "cloud_upload_document_versions");
    expect((versions?.[1] as { versions: unknown[] }).versions).toHaveLength(1);

    expect(files.get(`${ROOT.path}/.ghost/folder.json`)).toContain(`"cloudRootId": "${ROOT.id}"`);
    expect(files.get(`${ROOT.path}/.ghost/index.json`)).toContain('"deep/inner": "f2"');
  });

  it("does nothing for a root that already has a Cloud ID", async () => {
    const { fs } = memoryFs();
    await writeGhostFolderMetadata(fs, ROOT.path, { version: 1, rootId: ROOT.id, cloudRootId: "cloud-1", createdAt: "x" });
    const { client, rpc } = fakeClient();
    const result = await uploadMirroredRoot({
      client, fs, ghostFolder: null,
      openPersistence: async () => ({ status: "ready", destroy: async () => undefined }),
    }, ROOT);
    expect(result.alreadyUploaded).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("recognises a server without the migration", () => {
    expect(isMissingServerFunction(new Error("Could not find the function public.cloud_adopt_items(items) in the schema cache"))).toBe(true);
    expect(isMissingServerFunction(new Error("permission denied"))).toBe(false);
  });
});
