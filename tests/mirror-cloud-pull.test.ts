// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { encodeBase64 } from "../src/cloud/collaboration/base64";
import { readGhostFolder, seedDocumentFromMarkdown, writeGhostIndex } from "../src/lib/mirror/adoption";
import { pullCloudChanges, type CloudPullDeps, type CloudUpdateRow } from "../src/lib/mirror/cloud-pull";
import { emptyGhostIndex, type GhostIndexEntry } from "../src/lib/mirror/ghost-index";
import type { MirrorFs } from "../src/lib/mirror/mirror-fs";
import type { TrackedRoot } from "../src/hooks/use-tracked-folders";

const ROOT_PATH = "/Users/me/Ghost/Notes";
const root: TrackedRoot = { id: "root-1", path: ROOT_PATH, kind: "mirrored", cloudRootId: "root-1" };

function hashOf(text: string): string {
  let value = 0;
  for (const character of text) value = (value * 31 + character.charCodeAt(0)) | 0;
  return `h${value}`;
}

export function memoryFs(initial: Record<string, string>) {
  const files = new Map(Object.entries(initial));
  const trashed: string[] = [];
  const moves: Array<{ from: string; to: string }> = [];
  const fs = {
    readText: async (path: string) => {
      const text = files.get(path);
      if (text === undefined) throw new Error(`missing ${path}`);
      return text;
    },
    writeText: async (path: string, content: string, options: { expectedVersion: unknown; force: boolean }) => {
      if (!options.force && options.expectedVersion === null && files.has(path)) throw new Error("version mismatch");
      files.set(path, content);
      return { canonical_path: path, size_bytes: content.length, modified_ns: "1", device_id: "1", file_id: "1" };
    },
    getVersion: async (path: string) => ({
      canonical_path: path, size_bytes: files.get(path)?.length ?? 0, modified_ns: "1", device_id: "1", file_id: "1",
    }),
    hashFile: async (path: string) => {
      const text = files.get(path);
      if (text === undefined) throw new Error(`missing ${path}`);
      return hashOf(text);
    },
    hashText: async (text: string) => hashOf(text),
    ensureDir: async () => undefined,
    listFiles: async () => [],
    listMarkdownFiles: async (dir: string) => Array.from(files.keys())
      .filter((path) => path.startsWith(`${dir}/`) && path.endsWith(".md") && !path.includes("/.ghost/"))
      .sort(),
    movePath: async (from: string, to: string) => {
      const text = files.get(from);
      if (text === undefined) throw new Error(`missing ${from}`);
      files.delete(from);
      files.set(to, text);
      moves.push({ from, to });
    },
    trashPath: async (path: string) => {
      files.delete(path);
      trashed.push(path);
    },
  } as unknown as MirrorFs;
  return { fs, files, trashed, moves };
}

export function updateFor(markdown: string, id: number): CloudUpdateRow {
  const document = new Y.Doc();
  seedDocumentFromMarkdown(document, markdown);
  const row = { id, update: encodeBase64(Y.encodeStateAsUpdate(document)) };
  document.destroy();
  return row;
}

export function headsClient(heads: Record<string, number>) {
  const rpc = vi.fn(async (name: string, args: { document_ids: string[] }) => {
    if (name !== "cloud_document_heads") return { data: null, error: null };
    return {
      data: args.document_ids.filter((id) => id in heads).map((id) => ({ document_id: id, last_update_id: heads[id] })),
      error: null,
    };
  });
  return { rpc } as unknown as SupabaseClient;
}

export function pullDeps(
  fs: MirrorFs,
  client: SupabaseClient,
  updates: Record<string, CloudUpdateRow[]>,
  isOpen?: (path: string) => boolean,
): CloudPullDeps & { fetched: string[] } {
  const stores = new Map<string, Uint8Array>();
  const fetched: string[] = [];
  return {
    fs,
    client,
    fetched,
    isOpen,
    openPersistence: async (rootId, documentId, document) => {
      const key = `${rootId}:${documentId}`;
      const saved = stores.get(key);
      if (saved) Y.applyUpdate(document, saved);
      const save = () => { stores.set(key, Y.encodeStateAsUpdate(document)); };
      document.on("update", save);
      return { status: "ready", destroy: async () => { document.off("update", save); } };
    },
    fetchUpdates: async (documentId, afterId) => {
      fetched.push(documentId);
      return (updates[documentId] ?? []).filter((row) => row.id > afterId);
    },
  };
}

async function seed(fs: MirrorFs, entries: Record<string, Partial<GhostIndexEntry> & { documentId: string }>) {
  const index = emptyGhostIndex();
  for (const [path, entry] of Object.entries(entries)) {
    index.documents[path] = {
      contentHash: null, mirrorVersion: null, mirrorStateVector: null, cloudDocumentId: entry.documentId, ...entry,
    };
  }
  await writeGhostIndex(fs, ROOT_PATH, index);
}

describe("pullCloudChanges", () => {
  it("rewrites a closed file Ghost wrote last and records the cursor", async () => {
    const original = "# Draft\n";
    const { fs, files } = memoryFs({ [`${ROOT_PATH}/plan.md`]: original });
    await seed(fs, { "plan.md": {
      documentId: "doc-plan", contentHash: hashOf(original),
      mirrorVersion: { canonical_path: "x", size_bytes: 1, modified_ns: "1", device_id: "1", file_id: "1" },
    } });
    const deps = pullDeps(fs, headsClient({ "doc-plan": 7 }), { "doc-plan": [updateFor("# Edited on the web\n\nHello.\n", 7)] });

    const result = await pullCloudChanges(deps, root);

    expect(result.written).toEqual(["plan.md"]);
    expect(files.get(`${ROOT_PATH}/plan.md`)).toContain("# Edited on the web");
    const { index } = await readGhostFolder(fs, ROOT_PATH);
    expect(index.documents["plan.md"].cloudCursor).toBe(7);
    expect(index.documents["plan.md"].contentHash).toBe(hashOf(files.get(`${ROOT_PATH}/plan.md`)!));
  });

  it("leaves a file that changed on disk to the next open, but still advances the cursor", async () => {
    const { fs, files } = memoryFs({ [`${ROOT_PATH}/plan.md`]: "# Changed by an agent\n" });
    await seed(fs, { "plan.md": { documentId: "doc-plan", contentHash: hashOf("# Draft\n") } });
    const deps = pullDeps(fs, headsClient({ "doc-plan": 3 }), { "doc-plan": [updateFor("# Web\n", 3)] });

    const result = await pullCloudChanges(deps, root);

    expect(result.deferred).toEqual(["plan.md"]);
    expect(files.get(`${ROOT_PATH}/plan.md`)).toBe("# Changed by an agent\n");
    expect((await readGhostFolder(fs, ROOT_PATH)).index.documents["plan.md"].cloudCursor).toBe(3);
  });

  it("skips open files and documents without new updates without fetching", async () => {
    const { fs } = memoryFs({ [`${ROOT_PATH}/open.md`]: "# a", [`${ROOT_PATH}/same.md`]: "# b" });
    await seed(fs, {
      "open.md": { documentId: "doc-open", contentHash: hashOf("# a") },
      "same.md": { documentId: "doc-same", contentHash: hashOf("# b"), cloudCursor: 9 },
    });
    const deps = pullDeps(fs, headsClient({ "doc-open": 4, "doc-same": 9 }), {}, (path) => path.endsWith("open.md"));

    const result = await pullCloudChanges(deps, root);

    expect(result).toEqual({ written: [], deferred: ["open.md"], checked: 2 });
    expect(deps.fetched).toEqual([]);
  });

  it("creates the file for a document that has never been on disk", async () => {
    const { fs, files } = memoryFs({});
    await seed(fs, { "Shared/Trip.md": { documentId: "doc-trip", cloudCursor: 0 } });
    const deps = pullDeps(fs, headsClient({ "doc-trip": 2 }), { "doc-trip": [updateFor("# Trip\n\nPack light.\n", 2)] });

    const result = await pullCloudChanges(deps, root);

    expect(result.written).toEqual(["Shared/Trip.md"]);
    expect(files.get(`${ROOT_PATH}/Shared/Trip.md`)).toContain("Pack light.");
  });

  it("never brings back a file that was deleted on disk", async () => {
    const { fs, files } = memoryFs({});
    await seed(fs, { "deleted.md": { documentId: "doc-del", contentHash: hashOf("# was here\n"), cloudCursor: 1 } });
    const deps = pullDeps(fs, headsClient({ "doc-del": 6 }), { "doc-del": [updateFor("# Edited elsewhere\n", 6)] });

    const result = await pullCloudChanges(deps, root);

    expect(result.written).toEqual([]);
    expect(files.has(`${ROOT_PATH}/deleted.md`)).toBe(false);
    expect((await readGhostFolder(fs, ROOT_PATH)).index.documents["deleted.md"].cloudCursor).toBe(1);
  });

  it("does nothing for a root that is not in Cloud", async () => {
    const { fs } = memoryFs({ [`${ROOT_PATH}/a.md`]: "# a" });
    await seed(fs, { "a.md": { documentId: "doc-a" } });
    const deps = pullDeps(fs, headsClient({ "doc-a": 1 }), {});
    expect(await pullCloudChanges(deps, { id: "r", path: ROOT_PATH, kind: "mirrored" })).toEqual({ written: [], deferred: [], checked: 0 });
  });
});
