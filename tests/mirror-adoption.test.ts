// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  adoptDocument,
  adoptFolder,
  readGhostFolder,
  seedDocumentFromMarkdown,
  updateGhostIndexEntry,
  type AdoptionDeps,
} from "../src/lib/mirror/adoption";
import { COLLABORATION_FIELD, createHeadlessMarkdownEditor } from "../src/components/editor/markdown-schema";
import { serializeMarkdownDocument } from "../src/components/editor/markdown-source";
import type { MirrorFs } from "../src/lib/mirror/mirror-fs";
import type { FileVersionToken } from "../src/lib/source-document";

function memoryMirrorFs(initial: Record<string, string>) {
  const files = new Map(Object.entries(initial));
  let counter = 1;
  const version = (path: string): FileVersionToken => ({
    canonical_path: path,
    size_bytes: files.get(path)?.length ?? 0,
    modified_ns: String(counter),
    device_id: "1",
    file_id: String(Math.abs(hashCode(path))),
  });
  const fs: MirrorFs = {
    readText: async (path) => {
      const text = files.get(path);
      if (text === undefined) throw new Error(`missing ${path}`);
      return text;
    },
    getVersion: async (path) => version(path),
    writeText: async (path, content) => {
      files.set(path, content);
      counter += 1;
      return version(path);
    },
    hashText: async (text) => `h${hashCode(text)}`,
    hashFile: async (path) => `h${hashCode(files.get(path) ?? "")}`,
    writeConflictCopy: async (path, content, label) => {
      const copy = path.replace(/\.md$/, ` (conflict ${label}).md`);
      files.set(copy, content);
      return copy;
    },
    ensureDir: async () => undefined,
    listFiles: async (dir) => Array.from(files.keys())
      .filter((path) => path.startsWith(`${dir}/`) && !path.slice(dir.length + 1).includes("/"))
      .map((path) => path.slice(dir.length + 1)),
    removeGhostFile: async (path) => { files.delete(path); },
    listMarkdownFiles: async (root) => Array.from(files.keys())
      .filter((path) => path.startsWith(`${root}/`) && path.endsWith(".md") && !path.includes("/.ghost/"))
      .sort(),
    createBookmark: async (path) => `bookmark:${path}`,
    resolveBookmark: async (bookmark) => ({ path: bookmark.replace(/^bookmark:/, ""), stale: false }),
  };
  return { fs, files };
}

function hashCode(text: string): number {
  let value = 0;
  for (const character of text) value = (value * 31 + character.charCodeAt(0)) | 0;
  return value;
}

/** In-memory Yjs stores keyed like IndexedDB would be. */
function memoryPersistence() {
  const stores = new Map<string, Uint8Array>();
  const openPersistence: AdoptionDeps["openPersistence"] = async (rootId, documentId, document) => {
    const key = `${rootId}:${documentId}`;
    const saved = stores.get(key);
    if (saved) Y.applyUpdate(document, saved);
    const save = () => { stores.set(key, Y.encodeStateAsUpdate(document)); };
    document.on("update", save);
    return {
      status: "ready",
      destroy: async () => { document.off("update", save); },
    };
  };
  return { stores, openPersistence };
}

function deps(fs: MirrorFs, openPersistence: AdoptionDeps["openPersistence"]): AdoptionDeps {
  let ids = 0;
  return {
    fs,
    openPersistence,
    newDocumentId: () => `doc-${++ids}`,
    now: () => new Date("2026-09-02T12:00:00.000Z"),
  };
}

function markdownOf(update: Uint8Array): string {
  const document = new Y.Doc();
  Y.applyUpdate(document, update);
  const editor = createHeadlessMarkdownEditor({ collaboration: document });
  try {
    return serializeMarkdownDocument(editor);
  } finally {
    editor.destroy();
    document.destroy();
  }
}

describe("folder adoption", () => {
  it("adopts every Markdown file, seeds its document, and writes .ghost metadata", async () => {
    const { fs, files } = memoryMirrorFs({
      "/r/plan.md": "# Plan\n\nOne.\n",
      "/r/sub/notes.md": "- a\n- b\n",
      "/r/image.png": "binary",
    });
    const { stores, openPersistence } = memoryPersistence();

    const result = await adoptFolder(deps(fs, openPersistence), "/r", "root-1");

    expect(result.adopted).toEqual(["plan.md", "sub/notes.md"]);
    expect(result.metadata.rootId).toBe("root-1");
    expect(files.get("/r/.ghost/folder.json")).toContain('"rootId": "root-1"');
    const { index } = await readGhostFolder(fs, "/r");
    expect(Object.keys(index.documents)).toEqual(["plan.md", "sub/notes.md"]);
    const plan = index.documents["plan.md"];
    expect(plan.mirrorVersion?.canonical_path).toBe("/r/plan.md");
    expect(plan.mirrorStateVector).toBeTruthy();
    expect(markdownOf(stores.get(`root-1:${plan.documentId}`)!)).toBe("# Plan\n\nOne.");
  });

  it("keeps document IDs across renames and adopts only new files on a second pass", async () => {
    const { fs, files } = memoryMirrorFs({ "/r/plan.md": "# Plan\n" });
    const { openPersistence } = memoryPersistence();
    const d = deps(fs, openPersistence);
    const first = await adoptFolder(d, "/r", "root-1");
    const planId = first.index.documents["plan.md"].documentId;

    files.delete("/r/plan.md");
    files.set("/r/roadmap.md", "# Plan\n");
    files.set("/r/new.md", "# New\n");

    const second = await adoptFolder(d, "/r", "root-1");
    expect(second.renamed).toEqual([{ from: "plan.md", to: "roadmap.md" }]);
    expect(second.adopted).toEqual(["new.md"]);
    expect(second.index.documents["roadmap.md"].documentId).toBe(planId);
    expect(second.index.documents["new.md"].documentId).not.toBe(planId);
  });

  it("does not re-seed a document the local store already holds", async () => {
    const { fs } = memoryMirrorFs({ "/r/plan.md": "# Plan\n\nEdited on disk.\n" });
    const { stores, openPersistence } = memoryPersistence();
    const seeded = new Y.Doc();
    seedDocumentFromMarkdown(seeded, "# Plan\n\nFrom the store.\n");
    stores.set("root-1:doc-keep", Y.encodeStateAsUpdate(seeded));

    const adopted = await adoptDocument(deps(fs, openPersistence), "/r", "root-1", "plan.md", {
      documentId: "doc-keep",
      contentHash: null,
      mirrorVersion: null,
      mirrorStateVector: null,
    });

    expect(adopted.keptExisting).toBe(true);
    expect(markdownOf(stores.get("root-1:doc-keep")!)).toBe("# Plan\n\nFrom the store.");
    // The disk differs, so nothing is recorded as current; opening will conflict.
    expect(adopted.entry.mirrorVersion).toBeNull();
    expect(adopted.entry.mirrorStateVector).toBeNull();
  });

  it("records a matching disk copy as current when the store already holds the document", async () => {
    const { fs } = memoryMirrorFs({ "/r/plan.md": "# Plan\n\n* same\n" });
    const { stores, openPersistence } = memoryPersistence();
    const seeded = new Y.Doc();
    seedDocumentFromMarkdown(seeded, "# Plan\n\n- same\n");
    stores.set("root-1:doc-keep", Y.encodeStateAsUpdate(seeded));

    const adopted = await adoptDocument(deps(fs, openPersistence), "/r", "root-1", "plan.md", {
      documentId: "doc-keep", contentHash: null, mirrorVersion: null, mirrorStateVector: null,
    });
    expect(adopted.entry.mirrorVersion?.canonical_path).toBe("/r/plan.md");
    expect(adopted.entry.mirrorStateVector).toBeTruthy();
  });

  it("serialises index updates per root", async () => {
    const { fs } = memoryMirrorFs({});
    await Promise.all([
      updateGhostIndexEntry(fs, "/r", "a.md", { documentId: "a", contentHash: null, mirrorVersion: null, mirrorStateVector: null }),
      updateGhostIndexEntry(fs, "/r", "b.md", { documentId: "b", contentHash: null, mirrorVersion: null, mirrorStateVector: null }),
    ]);
    const { index } = await readGhostFolder(fs, "/r");
    expect(Object.keys(index.documents).sort()).toEqual(["a.md", "b.md"]);
  });

  it("seeds through the shared schema so the fragment name matches the editor", () => {
    const document = new Y.Doc();
    seedDocumentFromMarkdown(document, "# Hello\n");
    expect(document.getXmlFragment(COLLABORATION_FIELD).length).toBeGreaterThan(0);
  });
});
