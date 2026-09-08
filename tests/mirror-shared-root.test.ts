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

describe("planSharedRoot safety", () => {
  it("drops names that could leave the Shared root, and their subtrees", () => {
    const up = item({ id: "up", name: "..", kind: "folder" });
    const inside = item({ id: "inside", name: "Plan.md", parent_id: "up", shared_root_id: "up" });
    const ghost = item({ id: "g", name: ".ghost", kind: "folder" });
    const slash = item({ id: "s", name: "a/b.md" });
    const nested = item({ id: "n", name: "Ok", kind: "folder" });
    const nestedBad = item({ id: "nb", name: "..", kind: "folder", parent_id: "n", shared_root_id: "n" });
    const nestedDoc = item({ id: "nd", name: "x.md", parent_id: "nb", shared_root_id: "n" });
    const evilSharer = item({ id: "e1", name: "Trip.md", shared_by: "../../x" });
    const other = item({ id: "e2", name: "Trip.md", shared_by: "Sam" });

    // Same names sort stably, so the later share takes the sharer suffix.
    const plan = planSharedRoot([up, inside, ghost, slash, nested, nestedBad, nestedDoc, other, evilSharer]);

    expect(Object.keys(plan.documents).sort()).toEqual(["Trip (.. .. x).md", "Trip.md"]);
    expect(plan.documents["Trip (.. .. x).md"].id).toBe("e1");
    expect(plan.folders).toEqual({ Ok: "n" });
  });
});

function sharedClient(roles: Record<string, string | null> = {}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const upserts: Array<Record<string, unknown>> = [];
  let created = 0;
  const rpc = async (name: string, args: Record<string, unknown> = {}) => {
    calls.push({ name, args });
    if (name === "cloud_document_heads") return { data: [], error: null };
    if (name === "cloud_adopt_items") return { data: (args.items as unknown[]).length, error: null };
    if (name === "cloud_create_item") return { data: { id: `made-${++created}`, name: args.item_name, kind: args.item_kind, parent_id: args.target_parent_id }, error: null };
    if (name === "cloud_document_role") return { data: roles[args.target_document_id as string] ?? null, error: null };
    return { data: null, error: null };
  };
  const client = { rpc, from: () => ({ upsert: async (row: Record<string, unknown>) => { upserts.push(row); return { error: null }; } }) } as never;
  return { client, calls, upserts };
}

describe("creating notes inside shared folders", () => {
  const editable = item({ id: "folder-plans", name: "Plans", kind: "folder", access_role: "editor" });
  const viewOnly = item({ id: "folder-ro", name: "Read", kind: "folder", access_role: "viewer" });

  it("puts a note made under an editable shared folder into the sharer's Cloud, and leaves a viewer's folder alone", async () => {
    const { fs, trashed } = memoryFs({
      [`${SHARED_PATH}/Plans/Mine.md`]: "# mine",
      [`${SHARED_PATH}/Plans/deeper/Also.md`]: "# also",
      [`${SHARED_PATH}/Read/Nope.md`]: "# nope",
    });
    await writeGhostIndex(fs, SHARED_PATH, emptyGhostIndex());
    const { client, calls, upserts } = sharedClient();
    const deps = { ...pullDeps(fs, client, {}), client };

    const result = await refreshSharedRoot(deps, sharedRoot, [editable, viewOnly]);

    expect(result.uploaded.sort()).toEqual(["Plans/Mine.md", "Plans/deeper/Also.md"]);
    expect(trashed).toEqual([]);
    const adopted = calls.filter((call) => call.name === "cloud_adopt_items")
      .map((call) => (call.args.items as Array<{ parent_id: string; name: string }>)[0]);
    expect(adopted).toEqual(expect.arrayContaining([
      expect.objectContaining({ parent_id: "folder-plans", name: "Mine.md" }),
      expect.objectContaining({ parent_id: "made-1", name: "Also.md" }),
    ]));
    expect(calls.find((call) => call.name === "cloud_create_item")?.args).toMatchObject({ item_kind: "folder", item_name: "deeper", target_parent_id: "folder-plans" });
    expect(upserts).toHaveLength(2);
    const { index } = await readGhostFolder(fs, SHARED_PATH);
    expect(index.documents["Plans/Mine.md"].cloudDocumentId).toBe(index.documents["Plans/Mine.md"].documentId);
    expect(index.folders).toMatchObject({ Plans: "folder-plans", "Plans/deeper": "made-1" });
    expect(index.documents["Read/Nope.md"]).toBeUndefined();
  });

  it("uploads a note the editor claimed, and keeps a just-shared note the listing lags behind", async () => {
    const { fs, trashed } = memoryFs({ [`${SHARED_PATH}/Plans/Claimed.md`]: "# claimed", [`${SHARED_PATH}/Plans/Lagging.md`]: "# lag" });
    const index = emptyGhostIndex();
    index.documents["Plans/Claimed.md"] = { documentId: "doc-claimed", contentHash: "h", mirrorVersion: null, mirrorStateVector: null };
    index.documents["Plans/Lagging.md"] = { documentId: "doc-lag", cloudDocumentId: "doc-lag", contentHash: "h", mirrorVersion: null, mirrorStateVector: null };
    index.documents["Plans/Gone.md"] = { documentId: "doc-gone", cloudDocumentId: "doc-gone", contentHash: "h", mirrorVersion: null, mirrorStateVector: null };
    await writeGhostIndex(fs, SHARED_PATH, index);
    const { client } = sharedClient({ "doc-lag": "editor", "doc-gone": null });
    const deps = { ...pullDeps(fs, client, {}), client };

    const result = await refreshSharedRoot(deps, sharedRoot, [editable]);

    expect(result.uploaded).toEqual(["Plans/Claimed.md"]);
    expect(result.removed).toEqual(["Plans/Gone.md"]);
    expect(trashed).toEqual([`${SHARED_PATH}/Plans/Gone.md`]);
    const after = (await readGhostFolder(fs, SHARED_PATH)).index;
    expect(after.documents["Plans/Claimed.md"].cloudDocumentId).toBe("doc-claimed");
    expect(after.documents["Plans/Lagging.md"].documentId).toBe("doc-lag");
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
