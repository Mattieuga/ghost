import { describe, expect, it } from "vitest";
import {
  emptyGhostIndex,
  ghostIndexFilePath,
  ghostVersionsDirPath,
  isInsideGhostDir,
  parseGhostFolderMetadata,
  parseGhostIndex,
  reconcileIndexWithDisk,
  relativeToRoot,
  serializeGhostIndex,
  type GhostIndex,
} from "../src/lib/mirror/ghost-index";

function indexWith(entries: Record<string, { documentId: string; contentHash: string | null }>): GhostIndex {
  const index = emptyGhostIndex();
  for (const [path, entry] of Object.entries(entries)) {
    index.documents[path] = {
      documentId: entry.documentId,
      contentHash: entry.contentHash,
      mirrorVersion: null,
      mirrorStateVector: null,
    };
  }
  return index;
}

describe(".ghost index", () => {
  it("round-trips through JSON with sorted, validated entries", () => {
    const index = indexWith({
      "b/second.md": { documentId: "doc-2", contentHash: "h2" },
      "a.md": { documentId: "doc-1", contentHash: null },
    });
    const text = serializeGhostIndex(index);
    expect(text.indexOf('"a.md"')).toBeLessThan(text.indexOf('"b/second.md"'));
    expect(parseGhostIndex(text)).toEqual(index);
  });

  it("treats damaged or foreign JSON as an empty index rather than failing", () => {
    expect(parseGhostIndex("not json")).toEqual(emptyGhostIndex());
    expect(parseGhostIndex('{"version":2,"documents":{}}')).toEqual(emptyGhostIndex());
    expect(parseGhostIndex('{"version":1,"documents":{"x.md":{"documentId":""}}}')).toEqual(emptyGhostIndex());
  });

  it("validates folder metadata", () => {
    expect(parseGhostFolderMetadata('{"version":1,"rootId":"root-1"}')).toMatchObject({
      rootId: "root-1",
      cloudRootId: null,
    });
    expect(parseGhostFolderMetadata('{"version":1}')).toBeNull();
  });

  it("resolves paths relative to the root and recognises its own folder", () => {
    expect(relativeToRoot("/Users/me/Ghost/Notes", "/Users/me/Ghost/Notes/a/b.md")).toBe("a/b.md");
    expect(relativeToRoot("/Users/me/Ghost/Notes", "/Users/me/Ghost/NotesX/b.md")).toBeNull();
    expect(isInsideGhostDir(".ghost/index.json")).toBe(true);
    expect(isInsideGhostDir("plan.md")).toBe(false);
    expect(ghostIndexFilePath("/r")).toBe("/r/.ghost/index.json");
    expect(ghostVersionsDirPath("/r", "doc-1")).toBe("/r/.ghost/versions/doc-1");
  });
});

describe("reconcileIndexWithDisk", () => {
  it("keeps a document's ID across a rename detected by content hash", () => {
    const index = indexWith({
      "plan.md": { documentId: "doc-plan", contentHash: "hash-plan" },
      "notes.md": { documentId: "doc-notes", contentHash: "hash-notes" },
    });
    const result = reconcileIndexWithDisk(index, [
      { relativePath: "roadmap.md", contentHash: "hash-plan" },
      { relativePath: "notes.md", contentHash: "hash-notes" },
      { relativePath: "new.md", contentHash: "hash-new" },
    ]);

    expect(result.renamed).toEqual([{ from: "plan.md", to: "roadmap.md" }]);
    expect(result.added).toEqual(["new.md"]);
    expect(result.removed).toEqual([]);
    expect(result.index.documents["roadmap.md"].documentId).toBe("doc-plan");
    expect(result.index.documents["plan.md"]).toBeUndefined();
    expect(result.index.documents["new.md"]).toBeUndefined();
  });

  it("reports removals when no new file carries the same content", () => {
    const index = indexWith({ "gone.md": { documentId: "doc-gone", contentHash: "h" } });
    const result = reconcileIndexWithDisk(index, []);
    expect(result.removed).toEqual(["gone.md"]);
    expect(result.index.documents).toEqual({});
  });

  it("matches duplicates deterministically and never claims a file twice", () => {
    const index = indexWith({
      "a.md": { documentId: "doc-a", contentHash: "same" },
      "b.md": { documentId: "doc-b", contentHash: "same" },
    });
    const result = reconcileIndexWithDisk(index, [
      { relativePath: "z.md", contentHash: "same" },
    ]);
    expect(result.renamed).toEqual([{ from: "a.md", to: "z.md" }]);
    expect(result.removed).toEqual(["b.md"]);
    expect(result.added).toEqual([]);
  });
});
