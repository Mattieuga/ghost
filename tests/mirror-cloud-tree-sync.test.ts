// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import type { VisibleCloudItem } from "../src/cloud/cloud-sharing";
import { readGhostFolder, writeGhostIndex } from "../src/lib/mirror/adoption";
import { pullCloudChanges } from "../src/lib/mirror/cloud-pull";
import { planCloudTree, syncCloudTreeToDisk } from "../src/lib/mirror/cloud-tree-sync";
import { emptyGhostIndex, type GhostIndexEntry } from "../src/lib/mirror/ghost-index";
import type { TrackedRoot } from "../src/hooks/use-tracked-folders";
import { headsClient, memoryFs, pullDeps, updateFor } from "./mirror-cloud-pull.test";

const ROOT = "/Users/me/Ghost/Notes";
const root: TrackedRoot = { id: "root-1", path: ROOT, kind: "mirrored", cloudRootId: "root-1" };

function item(overrides: Partial<VisibleCloudItem> & { id: string; name: string }): VisibleCloudItem {
  return {
    workspace_id: "w", parent_id: "root-1", kind: "document", root_kind: null, created_by: null,
    created_at: "t", updated_at: "t", deleted_at: null,
    access_role: "owner", shared_root_id: null, shared_by: null, shared_out: false,
    ...overrides,
  };
}
const notesRoot = item({ id: "root-1", name: "Notes", kind: "folder", parent_id: null, root_kind: "notes" });

function entry(overrides: Partial<GhostIndexEntry> & { documentId: string }): GhostIndexEntry {
  return { contentHash: "h", mirrorVersion: null, mirrorStateVector: null, cloudDocumentId: overrides.documentId, ...overrides };
}

describe("planCloudTree", () => {
  it("lays out the root's own subtree and ignores other roots and unsafe names", () => {
    const plan = planCloudTree([
      notesRoot,
      item({ id: "a", name: "a.md" }),
      item({ id: "f", name: "Plans", kind: "folder" }),
      item({ id: "b", name: "b.md", parent_id: "f" }),
      item({ id: "bad", name: "..", kind: "folder" }),
      item({ id: "other-root", name: "Work", kind: "folder", parent_id: null, root_kind: "folder" }),
      item({ id: "w", name: "w.md", parent_id: "other-root" }),
    ], "root-1");
    expect(Object.keys(plan!.documents).sort()).toEqual(["Plans/b.md", "a.md"]);
    expect(plan!.folders).toEqual({ Plans: "f" });
    expect(planCloudTree([item({ id: "x", name: "x.md" })], "root-1")).toBeNull();
  });
});

describe("syncCloudTreeToDisk", () => {
  it("moves, trashes, and adds files to match Cloud, leaving open and pending files alone", async () => {
    const { fs, files, trashed, moves } = memoryFs({
      [`${ROOT}/Old.md`]: "# a",
      [`${ROOT}/Gone.md`]: "# gone",
      [`${ROOT}/Open.md`]: "# open",
      [`${ROOT}/Renamed here.md`]: "# stale",
      [`${ROOT}/Local only.md`]: "# local",
    });
    const index = emptyGhostIndex();
    index.documents["Old.md"] = entry({ documentId: "a" });
    index.documents["Gone.md"] = entry({ documentId: "gone" });
    index.documents["Open.md"] = entry({ documentId: "open" });
    index.documents["Renamed here.md"] = entry({ documentId: "stale", cloudStale: true });
    index.documents["Local only.md"] = { documentId: "local", contentHash: "h", mirrorVersion: null, mirrorStateVector: null };
    await writeGhostIndex(fs, ROOT, index);

    const visible = [
      notesRoot,
      item({ id: "f", name: "Plans", kind: "folder" }),
      item({ id: "a", name: "New.md", parent_id: "f" }),
      item({ id: "open", name: "Open renamed.md" }),
      item({ id: "stale", name: "Old name.md" }),
      item({ id: "fresh", name: "Fresh.md" }),
    ];
    const deps = pullDeps(fs, headsClient({ fresh: 2 }), { fresh: [updateFor("# Fresh from the web\n", 2)] }, (path) => path.endsWith("Open.md"));

    const result = await syncCloudTreeToDisk(deps, root, visible);

    expect(result.moved).toEqual([{ from: "Old.md", to: "Plans/New.md" }]);
    expect(moves).toEqual([{ from: `${ROOT}/Old.md`, to: `${ROOT}/Plans/New.md` }]);
    expect(result.removed).toEqual(["Gone.md"]);
    expect(trashed).toEqual([`${ROOT}/Gone.md`]);
    expect(result.added).toEqual(["Fresh.md"]);
    expect(result.pendingOpen).toEqual([{ from: "Open.md", to: "Open renamed.md" }]);
    const { index: next } = await readGhostFolder(fs, ROOT);
    expect(Object.keys(next.documents).sort()).toEqual(["Fresh.md", "Local only.md", "Open.md", "Plans/New.md", "Renamed here.md"]);
    expect(next.folders).toEqual({ Plans: "f" });

    // The pull then writes the note created on the web.
    const pulled = await pullCloudChanges(deps, root);
    expect(pulled.written).toEqual(["Fresh.md"]);
    expect(files.get(`${ROOT}/Fresh.md`)).toContain("Fresh from the web");
  });

  it("does nothing when the root is not visible to this account", async () => {
    const { fs, trashed } = memoryFs({ [`${ROOT}/a.md`]: "# a" });
    const index = emptyGhostIndex();
    index.documents["a.md"] = entry({ documentId: "a" });
    await writeGhostIndex(fs, ROOT, index);
    const deps = pullDeps(fs, headsClient({}), {});
    expect(await syncCloudTreeToDisk(deps, root, [])).toEqual({ moved: [], removed: [], added: [], pendingOpen: [] });
    expect(trashed).toEqual([]);
  });
});
