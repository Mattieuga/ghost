// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import type { VisibleCloudItem } from "../src/cloud/cloud-sharing";
import { readGhostFolder, writeGhostIndex } from "../src/lib/mirror/adoption";
import { emptyGhostIndex } from "../src/lib/mirror/ghost-index";
import { planSharedRoot, refreshSharedRoot, SHARED_ROOT_ID } from "../src/lib/mirror/shared-root";
import type { TrackedRoot } from "../src/hooks/use-tracked-folders";
import { headsClient, memoryFs, pullDeps, updateFor } from "./mirror-cloud-pull.test";

const SHARED_PATH = "/Users/me/Ghost/Shared";
const sharedRoot: TrackedRoot = { id: SHARED_ROOT_ID, path: SHARED_PATH, kind: "mirrored", cloudRootId: SHARED_ROOT_ID, shared: true };

function item(overrides: Partial<VisibleCloudItem> & { id: string; name: string }): VisibleCloudItem {
  return {
    workspace_id: "w2", parent_id: null, kind: "document", root_kind: null, created_by: null,
    created_at: "t", updated_at: "t", deleted_at: null,
    access_role: "editor", shared_root_id: overrides.id, shared_by: "Sam", shared_out: false,
    ...overrides,
  };
}

const trip = item({ id: "doc-trip", name: "Trip.md" });
const tripByKim = item({ id: "doc-trip-kim", name: "Trip.md", shared_by: "Kim" });
const plans = item({ id: "folder-plans", name: "Plans", kind: "folder" });
const planA = item({ id: "doc-a", name: "a.md", parent_id: "folder-plans", shared_root_id: "folder-plans" });
const sub = item({ id: "folder-sub", name: "sub", kind: "folder", parent_id: "folder-plans", shared_root_id: "folder-plans" });
const planB = item({ id: "doc-b", name: "b.md", parent_id: "folder-sub", shared_root_id: "folder-plans" });
const own = item({ id: "own", name: "Mine.md", access_role: "owner", shared_root_id: null, shared_by: null });

describe("planSharedRoot", () => {
  it("lays shares out flat, keeps subtrees, and names collisions after the sharer", () => {
    const plan = planSharedRoot([own, trip, tripByKim, plans, planA, sub, planB]);
    expect(Object.keys(plan.documents).sort()).toEqual([
      "Plans/a.md", "Plans/sub/b.md", "Trip (Kim).md", "Trip.md",
    ]);
    expect(plan.documents["Trip (Kim).md"].id).toBe("doc-trip-kim");
    expect(plan.folders).toEqual({ Plans: "folder-plans", "Plans/sub": "folder-sub" });
  });
});

describe("refreshSharedRoot", () => {
  it("adds, moves, and trashes files to match what is shared, then pulls content", async () => {
    const { fs, files, trashed, moves } = memoryFs({
      [`${SHARED_PATH}/Plans/old-name.md`]: "# a",
      [`${SHARED_PATH}/Gone.md`]: "# gone",
    });
    const index = emptyGhostIndex();
    index.documents["Plans/old-name.md"] = {
      documentId: "doc-a", cloudDocumentId: "doc-a", contentHash: "h", mirrorVersion: null, mirrorStateVector: null, cloudCursor: 5,
    };
    index.documents["Gone.md"] = {
      documentId: "doc-gone", cloudDocumentId: "doc-gone", contentHash: "h", mirrorVersion: null, mirrorStateVector: null, cloudCursor: 1,
    };
    await writeGhostIndex(fs, SHARED_PATH, index);
    const deps = pullDeps(
      fs,
      headsClient({ "doc-trip": 3, "doc-a": 5, "doc-b": 4 }),
      { "doc-trip": [updateFor("# Trip\n", 3)], "doc-b": [updateFor("# B\n", 4)] },
    );

    const result = await refreshSharedRoot(deps, sharedRoot, [own, trip, plans, planA, sub, planB]);

    expect(result.added.sort()).toEqual(["Plans/sub/b.md", "Trip.md"]);
    expect(result.moved).toEqual([{ from: "Plans/old-name.md", to: "Plans/a.md" }]);
    expect(result.removed).toEqual(["Gone.md"]);
    expect(trashed).toEqual([`${SHARED_PATH}/Gone.md`]);
    expect(moves).toHaveLength(1);
    expect(result.pull.written.sort()).toEqual(["Plans/sub/b.md", "Trip.md"]);
    expect(files.get(`${SHARED_PATH}/Trip.md`)).toContain("# Trip");
    expect(files.get(`${SHARED_PATH}/Plans/sub/b.md`)).toContain("# B");
    expect(result.empty).toBe(false);

    const { metadata, index: next } = await readGhostFolder(fs, SHARED_PATH);
    expect(metadata?.cloudRootId).toBe(SHARED_ROOT_ID);
    expect(Object.keys(next.documents).sort()).toEqual(["Plans/a.md", "Plans/sub/b.md", "Trip.md"]);
    expect(next.folders).toEqual({ Plans: "folder-plans", "Plans/sub": "folder-sub" });
    expect(next.documents["Plans/a.md"].cloudCursor).toBe(5);
  });

  it("brings back a shared file removed by hand", async () => {
    const { fs, files } = memoryFs({});
    const index = emptyGhostIndex();
    index.documents["Trip.md"] = {
      documentId: "doc-trip", cloudDocumentId: "doc-trip", contentHash: "h", mirrorVersion: null, mirrorStateVector: null, cloudCursor: 3,
    };
    await writeGhostIndex(fs, SHARED_PATH, index);
    const deps = pullDeps(fs, headsClient({ "doc-trip": 3 }), { "doc-trip": [updateFor("# Trip\n", 3)] });

    const result = await refreshSharedRoot(deps, sharedRoot, [trip]);

    expect(result.pull.written).toEqual(["Trip.md"]);
    expect(files.get(`${SHARED_PATH}/Trip.md`)).toContain("# Trip");
  });

  it("keeps an open file in place when its share ends, and reports empty when nothing is shared", async () => {
    const { fs, trashed } = memoryFs({ [`${SHARED_PATH}/Open.md`]: "# open" });
    const index = emptyGhostIndex();
    index.documents["Open.md"] = {
      documentId: "doc-open", cloudDocumentId: "doc-open", contentHash: "h", mirrorVersion: null, mirrorStateVector: null, cloudCursor: 1,
    };
    await writeGhostIndex(fs, SHARED_PATH, index);
    const deps = pullDeps(fs, headsClient({}), {}, (path) => path.endsWith("Open.md"));

    const result = await refreshSharedRoot(deps, sharedRoot, [own]);

    expect(result.removed).toEqual([]);
    expect(trashed).toEqual([]);
    expect(result.empty).toBe(true);
    expect(Object.keys((await readGhostFolder(fs, SHARED_PATH)).index.documents)).toEqual(["Open.md"]);
  });
});
