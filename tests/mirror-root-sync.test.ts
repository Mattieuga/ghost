// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readGhostFolder, writeGhostIndex } from "../src/lib/mirror/adoption";
import { emptyGhostIndex, type GhostIndex } from "../src/lib/mirror/ghost-index";
import type { MirrorFs } from "../src/lib/mirror/mirror-fs";
import { ensureCloudDocument, reconcileMirroredRoot, type RootSyncDeps } from "../src/lib/mirror/root-sync";
import type { TrackedRoot } from "../src/hooks/use-tracked-folders";

const ROOT_PATH = "/Users/me/Ghost/Notes";

function hashOf(text: string): string {
  let value = 0;
  for (const character of text) value = (value * 31 + character.charCodeAt(0)) | 0;
  return `h${value}`;
}

function memoryFs(initial: Record<string, string>) {
  const files = new Map(Object.entries(initial));
  const fs = {
    readText: async (path: string) => {
      const text = files.get(path);
      if (text === undefined) throw new Error(`missing ${path}`);
      return text;
    },
    writeText: async (path: string, content: string) => {
      files.set(path, content);
      return { canonical_path: path, size_bytes: content.length, modified_ns: "1", device_id: "1", file_id: "1" };
    },
    getVersion: async (path: string) => ({
      canonical_path: path, size_bytes: files.get(path)?.length ?? 0, modified_ns: "1", device_id: "1", file_id: "1",
    }),
    hashFile: async (path: string) => hashOf(files.get(path) ?? ""),
    ensureDir: async () => undefined,
    listFiles: async () => [],
    listMarkdownFiles: async (root: string) => Array.from(files.keys())
      .filter((path) => path.startsWith(`${root}/`) && path.endsWith(".md") && !path.includes("/.ghost/"))
      .sort(),
  } as unknown as MirrorFs;
  return { fs, files };
}

function fakeClient() {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    if (name === "cloud_create_item") {
      return { data: { id: args.target_item_id ?? "server-id", name: args.item_name, kind: args.item_kind, parent_id: args.target_parent_id }, error: null };
    }
    if (name === "cloud_rename_item" || name === "cloud_move_item") {
      return { data: { id: args.target_item_id }, error: null };
    }
    if (name === "cloud_adopt_items") return { data: (args.items as unknown[]).length, error: null };
    return { data: null, error: null };
  });
  const upsert = vi.fn(async () => ({ error: null }));
  const client = { rpc, from: () => ({ upsert }) } as unknown as SupabaseClient;
  return { client, calls, upsert };
}

function deps(fs: MirrorFs, client: SupabaseClient | null, isOpen?: (path: string) => boolean): RootSyncDeps {
  let ids = 0;
  const stores = new Map<string, Uint8Array>();
  return {
    fs,
    client,
    openPersistence: async (rootId, documentId, document) => {
      const key = `${rootId}:${documentId}`;
      const saved = stores.get(key);
      if (saved) Y.applyUpdate(document, saved);
      const save = () => { stores.set(key, Y.encodeStateAsUpdate(document)); };
      document.on("update", save);
      return { status: "ready", destroy: async () => { document.off("update", save); } };
    },
    newDocumentId: () => `new-${++ids}`,
    isOpen,
  };
}

const uploadedRoot: TrackedRoot = { id: "root-1", path: ROOT_PATH, kind: "mirrored", cloudRootId: "root-1" };

async function seedIndex(fs: MirrorFs, entries: Record<string, { id: string; hash: string; cloud?: boolean }>) {
  const index: GhostIndex = emptyGhostIndex();
  for (const [path, entry] of Object.entries(entries)) {
    index.documents[path] = {
      documentId: entry.id,
      contentHash: entry.hash,
      mirrorVersion: null,
      mirrorStateVector: null,
      ...(entry.cloud ? { cloudDocumentId: entry.id } : {}),
    };
  }
  await writeGhostIndex(fs, ROOT_PATH, index);
}

describe("reconcileMirroredRoot", () => {
  it("trashes the Cloud copy of a file deleted on disk and drops it from the index", async () => {
    const { fs } = memoryFs({ [`${ROOT_PATH}/keep.md`]: "# keep" });
    await seedIndex(fs, {
      "keep.md": { id: "doc-keep", hash: hashOf("# keep"), cloud: true },
      "gone.md": { id: "doc-gone", hash: hashOf("# gone"), cloud: true },
    });
    const { client, calls } = fakeClient();

    const result = await reconcileMirroredRoot(deps(fs, client), uploadedRoot);

    expect(result.removed).toEqual(["gone.md"]);
    expect(calls).toEqual([{ name: "cloud_trash_item", args: { target_item_id: "doc-gone" } }]);
    expect(Object.keys((await readGhostFolder(fs, ROOT_PATH)).index.documents)).toEqual(["keep.md"]);
  });

  it("renames and moves in Cloud when a file is renamed or moved on disk", async () => {
    const { fs } = memoryFs({
      [`${ROOT_PATH}/Renamed.md`]: "# one",
      [`${ROOT_PATH}/archive/two.md`]: "# two",
    });
    await seedIndex(fs, {
      "Old.md": { id: "doc-one", hash: hashOf("# one"), cloud: true },
      "two.md": { id: "doc-two", hash: hashOf("# two"), cloud: true },
    });
    const { client, calls } = fakeClient();

    const result = await reconcileMirroredRoot(deps(fs, client), uploadedRoot);

    expect(result.renamed).toEqual([
      { from: "Old.md", to: "Renamed.md" },
      { from: "two.md", to: "archive/two.md" },
    ]);
    expect(calls.map((call) => call.name)).toEqual([
      "cloud_rename_item",
      "cloud_create_item",
      "cloud_move_item",
    ]);
    expect(calls[0].args).toEqual({ target_item_id: "doc-one", item_name: "Renamed.md" });
    expect(calls[1].args).toMatchObject({ item_kind: "folder", item_name: "archive", target_parent_id: "root-1" });
    expect(calls[2].args).toEqual({ target_item_id: "doc-two", target_parent_id: "new-1" });
    const { index } = await readGhostFolder(fs, ROOT_PATH);
    expect(index.folders).toEqual({ archive: "new-1" });
    expect(index.documents["archive/two.md"].documentId).toBe("doc-two");
  });

  it("adopts a new file, creates it in Cloud under the same ID, and pushes its state", async () => {
    const { fs } = memoryFs({ [`${ROOT_PATH}/fresh.md`]: "# fresh\n\nwritten by an agent\n" });
    await seedIndex(fs, {});
    const { client, calls, upsert } = fakeClient();

    const result = await reconcileMirroredRoot(deps(fs, client), uploadedRoot);

    expect(result.added).toEqual(["fresh.md"]);
    expect(result.uploaded).toEqual(["fresh.md"]);
    expect(calls[0]).toEqual({
      name: "cloud_adopt_items",
      args: { items: [{ id: "new-1", parent_id: "root-1", kind: "document", name: "fresh.md" }] },
    });
    expect(upsert).toHaveBeenCalledTimes(1);
    const { index } = await readGhostFolder(fs, ROOT_PATH);
    expect(index.documents["fresh.md"]).toMatchObject({ documentId: "new-1", cloudDocumentId: "new-1" });
  });

  it("keeps deletions and renames of an uploaded root until signed in, then carries them over", async () => {
    const { fs } = memoryFs({ [`${ROOT_PATH}/open.md`]: "# open", [`${ROOT_PATH}/New.md`]: "# one" });
    await seedIndex(fs, {
      "gone.md": { id: "doc-gone", hash: "h", cloud: true },
      "Old.md": { id: "doc-one", hash: hashOf("# one"), cloud: true },
    });

    const signedOut = await reconcileMirroredRoot(deps(fs, null, (path) => path.endsWith("/open.md")), uploadedRoot);

    expect(signedOut.cloud).toBe(false);
    expect(signedOut.removed).toEqual([]);
    expect(signedOut.renamed).toEqual([{ from: "Old.md", to: "New.md" }]);
    let { index } = await readGhostFolder(fs, ROOT_PATH);
    expect(index.documents["open.md"]).toBeUndefined();
    expect(Object.keys(index.documents).sort()).toEqual(["New.md", "gone.md"]);
    expect(index.documents["New.md"]).toMatchObject({ documentId: "doc-one", cloudStale: true });

    const { client, calls } = fakeClient();
    const signedIn = await reconcileMirroredRoot(deps(fs, client, (path) => path.endsWith("/open.md")), uploadedRoot);

    expect(signedIn.removed).toEqual(["gone.md"]);
    expect(calls.map((call) => call.name)).toEqual(["cloud_trash_item", "cloud_move_item", "cloud_rename_item"]);
    expect(calls[2].args).toEqual({ target_item_id: "doc-one", item_name: "New.md" });
    ({ index } = await readGhostFolder(fs, ROOT_PATH));
    expect(Object.keys(index.documents)).toEqual(["New.md"]);
    expect(index.documents["New.md"].cloudStale).toBeUndefined();
  });

  it("drops deletions at once for a root that is not in Cloud", async () => {
    const { fs } = memoryFs({});
    await seedIndex(fs, { "gone.md": { id: "doc-gone", hash: "h" } });
    const local: TrackedRoot = { id: "root-2", path: ROOT_PATH, kind: "mirrored" };

    const result = await reconcileMirroredRoot(deps(fs, null), local);

    expect(result.removed).toEqual(["gone.md"]);
    expect((await readGhostFolder(fs, ROOT_PATH)).index.documents).toEqual({});
  });

  it("puts documents adopted while signed out into Cloud on the next signed-in pass", async () => {
    const { fs } = memoryFs({ [`${ROOT_PATH}/later.md`]: "# later" });
    await seedIndex(fs, { "later.md": { id: "doc-later", hash: hashOf("# later") } });
    const { client, calls, upsert } = fakeClient();

    const result = await reconcileMirroredRoot(deps(fs, client), uploadedRoot);

    expect(result.added).toEqual([]);
    expect(result.uploaded).toEqual(["later.md"]);
    expect(calls[0].name).toBe("cloud_adopt_items");
    expect(upsert).toHaveBeenCalledTimes(0);
    expect((await readGhostFolder(fs, ROOT_PATH)).index.documents["later.md"].cloudDocumentId).toBe("doc-later");
  });
});

describe("ensureCloudDocument", () => {
  it("creates a document once and records it in the index", async () => {
    const { fs } = memoryFs({ [`${ROOT_PATH}/note.md`]: "# note" });
    await seedIndex(fs, { "note.md": { id: "doc-note", hash: hashOf("# note") } });
    const { client, calls } = fakeClient();

    expect(await ensureCloudDocument(deps(fs, client), uploadedRoot, "note.md", "doc-note")).toBe(true);
    expect(calls[0]).toEqual({
      name: "cloud_adopt_items",
      args: { items: [{ id: "doc-note", parent_id: "root-1", kind: "document", name: "note.md" }] },
    });
    expect(await ensureCloudDocument(deps(fs, client), uploadedRoot, "note.md", "doc-note")).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("does nothing for a root that is not in Cloud", async () => {
    const { fs } = memoryFs({});
    await seedIndex(fs, {});
    const { client, calls } = fakeClient();
    const local: TrackedRoot = { id: "root-2", path: ROOT_PATH, kind: "mirrored" };
    expect(await ensureCloudDocument(deps(fs, client), local, "note.md", "doc")).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
