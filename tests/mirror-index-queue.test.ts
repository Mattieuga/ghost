// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import {
  commitIndexPass,
  locateRenamedEntry,
  readGhostFolder,
  relocateIndexEntry,
  updateGhostIndexEntry,
  writeGhostIndex,
} from "../src/lib/mirror/adoption";
import { emptyGhostIndex, type GhostIndex, type GhostIndexEntry } from "../src/lib/mirror/ghost-index";
import { MirrorWriter } from "../src/lib/mirror/mirror-writer";
import { memoryFs } from "./mirror-cloud-pull.test";

const ROOT = "/Users/me/Ghost/Notes";

function entry(overrides: Partial<GhostIndexEntry> & { documentId: string }): GhostIndexEntry {
  return { contentHash: null, mirrorVersion: null, mirrorStateVector: null, ...overrides };
}

function version(tag: string) {
  return { canonical_path: ROOT, size_bytes: 1, modified_ns: tag, device_id: "1", file_id: "1" };
}

describe("index writes", () => {
  it("keeps what the editor recorded while a pass was running, and drops what the pass removed", async () => {
    const { fs } = memoryFs({});
    const start: GhostIndex = emptyGhostIndex();
    start.documents["a.md"] = entry({ documentId: "a", contentHash: "h1", mirrorVersion: version("1") });
    start.documents["gone.md"] = entry({ documentId: "g", contentHash: "hg" });
    await writeGhostIndex(fs, ROOT, start);
    const snapshot = structuredClone(start);

    // The editor records a newer write and Cloud membership while the pass runs.
    await updateGhostIndexEntry(fs, ROOT, "a.md", entry({ documentId: "a", contentHash: "h2", mirrorVersion: version("2") }));
    await updateGhostIndexEntry(fs, ROOT, "typed.md", entry({ documentId: "t", contentHash: "ht" }));

    // The pass marks a.md as in Cloud, removes gone.md, and adds fresh.md.
    const result: GhostIndex = emptyGhostIndex();
    result.documents["a.md"] = { ...snapshot.documents["a.md"], cloudDocumentId: "a", cloudCursor: 3 };
    result.documents["fresh.md"] = entry({ documentId: "f", contentHash: "hf", cloudDocumentId: "f" });
    await commitIndexPass(fs, ROOT, snapshot, result);

    const { index } = await readGhostFolder(fs, ROOT);
    expect(index.documents["a.md"]).toMatchObject({ contentHash: "h2", cloudDocumentId: "a", cloudCursor: 3 });
    expect(index.documents["a.md"].mirrorVersion?.modified_ns).toBe("2");
    expect(index.documents["gone.md"]).toBeUndefined();
    expect(index.documents["typed.md"].documentId).toBe("t");
    expect(index.documents["fresh.md"].cloudDocumentId).toBe("f");
  });

  it("carries Cloud fields through an editor record", async () => {
    const { fs } = memoryFs({});
    const start = emptyGhostIndex();
    start.documents["a.md"] = entry({ documentId: "a", cloudDocumentId: "a", cloudCursor: 7, cloudStale: true });
    await writeGhostIndex(fs, ROOT, start);

    await updateGhostIndexEntry(fs, ROOT, "a.md", entry({ documentId: "a", contentHash: "h9" }));

    const { index } = await readGhostFolder(fs, ROOT);
    expect(index.documents["a.md"]).toMatchObject({ contentHash: "h9", cloudDocumentId: "a", cloudCursor: 7, cloudStale: true });
  });

  it("relocates an entry and finds the entry a renamed file came from", async () => {
    const { fs } = memoryFs({ [`${ROOT}/New.md`]: "# same" });
    const start = emptyGhostIndex();
    start.documents["Old.md"] = entry({ documentId: "d", contentHash: "hs", cloudDocumentId: "d" });
    start.documents["Other.md"] = entry({ documentId: "o", contentHash: "hs" });
    await writeGhostIndex(fs, ROOT, start);

    const { index } = await readGhostFolder(fs, ROOT);
    // Other.md is still on disk? It is not in the memory fs, so it looks missing too;
    // the first missing match wins, which is Old.md by key order.
    expect(await locateRenamedEntry(fs, ROOT, index, "New.md", "hs")).toBe("Old.md");
    expect(await locateRenamedEntry(fs, ROOT, index, "New.md", "nope")).toBeNull();

    const moved = await relocateIndexEntry(fs, ROOT, "Old.md", "New.md", { cloudStale: true });
    expect(moved).toMatchObject({ documentId: "d", cloudStale: true });
    const after = (await readGhostFolder(fs, ROOT)).index;
    expect(after.documents["Old.md"]).toBeUndefined();
    expect(after.documents["New.md"].documentId).toBe("d");

    // Never onto another document.
    expect(await relocateIndexEntry(fs, ROOT, "Other.md", "New.md")).toBeNull();
    expect((await readGhostFolder(fs, ROOT)).index.documents["Other.md"].documentId).toBe("o");
  });
});

describe("MirrorWriter without a disk record", () => {
  it("holds the first write until ingestion says what is on disk, then writes what was typed", async () => {
    vi.useFakeTimers();
    try {
      const document = new Y.Doc();
      const writes: string[] = [];
      const conflicts = vi.fn();
      const statuses: string[] = [];
      const writer = new MirrorWriter({
        document,
        initialRecord: { version: null, stateVector: null, contentHash: null },
        serialize: () => document.getText("t").toString(),
        write: async (content) => { writes.push(content); return version("w"); },
        hash: async (content) => `h:${content}`,
        onRecord: () => undefined,
        onConflict: conflicts,
        onStatus: (status) => statuses.push(status),
        debounceMs: 10,
      });
      writer.start();

      document.getText("t").insert(0, "typed");
      await vi.advanceTimersByTimeAsync(20);
      expect(writes).toEqual([]);
      expect(conflicts).toHaveBeenCalledTimes(1);
      expect(statuses).toContain("conflict");

      // Ingestion resolves the disk; the typed edit is then owed to the file.
      writer.markDiskCurrent(version("disk"), "h:disk");
      await vi.advanceTimersByTimeAsync(20);
      expect(writes).toEqual(["typed"]);
      expect(writer.status).toBe("saved");
    } finally {
      vi.useRealTimers();
    }
  });
});
