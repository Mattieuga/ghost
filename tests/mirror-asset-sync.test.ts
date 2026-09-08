// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as Y from "yjs";
import { readGhostFolder, seedDocumentFromMarkdown, writeGhostIndex } from "../src/lib/mirror/adoption";
import {
  companionAssetsDir,
  followCompanionRename,
  pullDocumentAssets,
  pushDocumentAssets,
  rewriteCompanionLinks,
} from "../src/lib/mirror/asset-sync";
import { emptyGhostIndex } from "../src/lib/mirror/ghost-index";
import type { MirrorFs } from "../src/lib/mirror/mirror-fs";
import type { TrackedRoot } from "../src/hooks/use-tracked-folders";
import { createHeadlessMarkdownEditor } from "../src/components/editor/markdown-schema";
import { serializeMarkdownDocument } from "../src/components/editor/markdown-source";
import { headsClient, memoryFs, pullDeps } from "./mirror-cloud-pull.test";

const ROOT = "/Users/me/Ghost/Notes";
const root: TrackedRoot = { id: "r", path: ROOT, kind: "mirrored", cloudRootId: "r" };

function bytesFs(initial: Record<string, string>) {
  const files = new Map<string, Uint8Array>(Object.entries(initial).map(([path, text]) => [path, new TextEncoder().encode(text)]));
  const texts = new Map<string, string>();
  const unlistable = new Set<string>();
  const fs = {
    readText: async (path: string) => { const t = texts.get(path); if (t === undefined) throw new Error("missing"); return t; },
    writeText: async (path: string, content: string) => { texts.set(path, content); return { canonical_path: path, size_bytes: 1, modified_ns: "1", device_id: "1", file_id: "1" }; },
    ensureDir: async () => undefined,
    hashFile: async (path: string) => { const b = files.get(path); if (!b) throw new Error("missing"); return `h:${Array.from(b).join(",")}`; },
    isDirectory: async (dir: string) => Array.from(files.keys()).some((p) => p.startsWith(`${dir}/`)),
    listFiles: async (dir: string) => {
      if (unlistable.has(dir)) throw new Error("permission denied");
      return Array.from(files.keys()).filter((p) => p.startsWith(`${dir}/`)).map((p) => p.slice(dir.length + 1));
    },
    readBytes: async (path: string) => { const b = files.get(path); if (!b) throw new Error("missing"); return b; },
    writeBytes: async (path: string, data: Uint8Array) => { files.set(path, data); },
  } as unknown as MirrorFs;
  return { fs, files, unlistable };
}

function storageClient(remote: Record<string, { etag: string; body: string }>) {
  const uploads: string[] = [];
  const removed: string[] = [];
  const bucket = {
    list: async (prefix: string) => ({
      data: Object.keys(remote).filter((key) => key.startsWith(`${prefix}/`)).map((key) => ({ name: key.slice(prefix.length + 1), metadata: { eTag: remote[key].etag } })),
      error: null,
    }),
    upload: async (path: string, body: Uint8Array) => { uploads.push(path); remote[path] = { etag: `e:${path}`, body: new TextDecoder().decode(body) }; return { data: { path }, error: null }; },
    remove: async (paths: string[]) => { for (const p of paths) { removed.push(p); delete remote[p]; } return { data: [], error: null }; },
    download: async (path: string) => ({ data: new Blob([remote[path].body]), error: null }),
  };
  return { client: { storage: { from: () => bucket } } as unknown as SupabaseClient, uploads, removed, remote };
}

describe("companion asset sync", () => {
  it("names the folder beside the note", () => {
    expect(companionAssetsDir(ROOT, "Plan.md")).toBe(`${ROOT}/Plan.assets`);
    expect(companionAssetsDir(ROOT, "deep/Trip notes.markdown")).toBe(`${ROOT}/deep/Trip notes.assets`);
  });

  it("does not read a folder it cannot list as a folder whose images were deleted", async () => {
    const { fs, unlistable } = bytesFs({ [`${ROOT}/Plan.assets/a.png`]: "AAA" });
    unlistable.add(`${ROOT}/Plan.assets`);
    const index = emptyGhostIndex();
    index.documents["Plan.md"] = {
      documentId: "d", cloudDocumentId: "d", contentHash: "h", mirrorVersion: null, mirrorStateVector: null,
      assets: { "a.png": { hash: "h:65,65,65", etag: "e" } },
    };
    await writeGhostIndex(fs, ROOT, index);
    const { client, removed } = storageClient({ "d/a.png": { etag: "e", body: "AAA" } });

    await expect(pushDocumentAssets({ fs, client }, root, "Plan.md")).rejects.toThrow("permission denied");
    expect(removed).toEqual([]);
  });

  it("rewrites companion links the way the native side does", () => {
    const content = [
      "![A](notes.assets/a.png) and ![B](notes.assets/b.png \"Title\")",
      "![C](<notes.assets/c.png>) <img src=\"notes.assets/d.png\" width=\"300\">",
      "See notes.assets for the originals.",
    ].join("\n");
    expect(rewriteCompanionLinks(content, "notes.assets", "notes copy.assets")).toBe([
      "![A](<notes copy.assets/a.png>) and ![B](<notes copy.assets/b.png> \"Title\")",
      "![C](<notes copy.assets/c.png>) <img src=\"notes copy.assets/d.png\" width=\"300\">",
      "See notes copy.assets for the originals.",
    ].join("\n"));
    expect(rewriteCompanionLinks("![A](notes.assets/a.png)", "notes.assets", "renamed.assets")).toBe("![A](renamed.assets/a.png)");
  });

  it("brings the document up to date with a renamed note's rewritten links, and no further", async () => {
    // The mirror writes the serializer's text as it is, without a final newline.
    const original = "# Trip\n\n![](Trip.assets/map.png)";
    const rewritten = "# Trip\n\n![](<Trip (2026).assets/map.png>)";
    const { fs } = memoryFs({ [`${ROOT}/Trip (2026).md`]: rewritten });
    const upserts: unknown[] = [];
    const client = {
      ...headsClient({}),
      from: () => ({ upsert: async (row: unknown) => { upserts.push(row); return { error: null }; } }),
    } as never;
    const deps = pullDeps(fs, client, {});
    const document = new Y.Doc();
    const seeded = await deps.openPersistence(root.id, "trip", document);
    seedDocumentFromMarkdown(document, original);
    await seeded.destroy();
    const entry = { documentId: "trip", cloudDocumentId: "trip", contentHash: await fs.hashText(original), mirrorVersion: null, mirrorStateVector: null };

    const followed = await followCompanionRename(deps, root, entry, "Trip.md", "Trip (2026).md");

    expect(followed.contentHash).toBe(await fs.hashText(rewritten));
    expect(followed.mirrorStateVector).not.toBeNull();
    expect(upserts).toHaveLength(1);
    const after = new Y.Doc();
    const handle = await deps.openPersistence(root.id, "trip", after);
    const editor = createHeadlessMarkdownEditor({ collaboration: after });
    expect(serializeMarkdownDocument(editor)).toBe(rewritten);
    editor.destroy();
    await handle.destroy();

    // A file that changed in any other way is left for ingestion.
    const { fs: edited } = memoryFs({ [`${ROOT}/Trip (2026).md`]: "# Trip edited\n\n![](<Trip (2026).assets/map.png>)\n" });
    const untouched = await followCompanionRename({ ...deps, fs: edited }, root, entry, "Trip.md", "Trip (2026).md");
    expect(untouched).toBe(entry);
  });

  it("pushes new and changed images, removes deleted ones, and skips the unchanged", async () => {
    const { fs, files } = bytesFs({ [`${ROOT}/Plan.assets/a.png`]: "AAA", [`${ROOT}/Plan.assets/b.png`]: "BBB", [`${ROOT}/Plan.assets/notes.txt`]: "x" });
    const index = emptyGhostIndex();
    index.documents["Plan.md"] = {
      documentId: "d", cloudDocumentId: "d", contentHash: "h", mirrorVersion: null, mirrorStateVector: null,
      assets: { "a.png": { hash: "h:65,65,65", etag: "old" }, "gone.png": { hash: "h:1", etag: "g" } },
    };
    await writeGhostIndex(fs, ROOT, index);
    const { client, uploads, removed } = storageClient({});

    const result = await pushDocumentAssets({ fs, client }, root, "Plan.md");

    expect(result.uploaded).toEqual(["b.png"]);
    expect(uploads).toEqual(["d/b.png"]);
    expect(removed).toEqual(["d/gone.png"]);
    const after = (await readGhostFolder(fs, ROOT)).index.documents["Plan.md"].assets!;
    expect(Object.keys(after).sort()).toEqual(["a.png", "b.png"]);
    expect(after["b.png"].etag).toBe("e:d/b.png");
    expect(files.has(`${ROOT}/Plan.assets/notes.txt`)).toBe(true);
  });

  it("pulls images that are new or changed in Cloud and leaves its own uploads alone", async () => {
    const { fs, files } = bytesFs({ [`${ROOT}/Plan.assets/mine.png`]: "MINE" });
    const index = emptyGhostIndex();
    index.documents["Plan.md"] = {
      documentId: "d", cloudDocumentId: "d", contentHash: "h", mirrorVersion: null, mirrorStateVector: null,
      assets: { "mine.png": { hash: "h:77,73,78,69", etag: "e:d/mine.png" }, "old.png": { hash: "h:0", etag: "stale" } },
    };
    await writeGhostIndex(fs, ROOT, index);
    const { client } = storageClient({
      "d/mine.png": { etag: "e:d/mine.png", body: "MINE" },
      "d/theirs.png": { etag: "t1", body: "THEIRS" },
      "d/old.png": { etag: "fresh", body: "NEWOLD" },
    });

    const result = await pullDocumentAssets({ fs, client }, root, "Plan.md");

    expect(result.downloaded.sort()).toEqual(["old.png", "theirs.png"]);
    expect(new TextDecoder().decode(files.get(`${ROOT}/Plan.assets/theirs.png`)!)).toBe("THEIRS");
    expect(new TextDecoder().decode(files.get(`${ROOT}/Plan.assets/old.png`)!)).toBe("NEWOLD");
    const after = (await readGhostFolder(fs, ROOT)).index.documents["Plan.md"].assets!;
    expect(after["theirs.png"].etag).toBe("t1");
    expect(after["old.png"].etag).toBe("fresh");
  });

  it("does nothing for a note that is not in Cloud", async () => {
    const { fs } = bytesFs({});
    const index = emptyGhostIndex();
    index.documents["Local.md"] = { documentId: "l", contentHash: "h", mirrorVersion: null, mirrorStateVector: null };
    await writeGhostIndex(fs, ROOT, index);
    const { client, uploads } = storageClient({});
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await pushDocumentAssets({ fs, client }, root, "Local.md")).toEqual({ uploaded: [], downloaded: [], removedRemote: [] });
    expect(uploads).toEqual([]);
  });
});
