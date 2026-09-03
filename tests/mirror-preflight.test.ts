import { describe, expect, it } from "vitest";
import type { TrackedRoot } from "../src/hooks/use-tracked-folders";
import {
  evaluateSyncPreflight,
  LARGE_FILE_COUNT,
  type SyncCandidate,
} from "../src/lib/mirror/preflight";
import { resolveMirroredRoot, volumeOf, type RootResolutionFs } from "../src/lib/mirror/root-resolution";

const HOME = "/Users/me";

function facts(overrides: Partial<SyncCandidate> = {}): SyncCandidate {
  return {
    path: `${HOME}/Cowork`,
    canonicalPath: `${HOME}/Cowork`,
    home: HOME,
    appDataDir: `${HOME}/Library/Application Support/com.ghost.app`,
    isDirectory: true,
    isPackage: false,
    writable: true,
    ancestorVcs: [],
    ancestorManaged: [],
    descendantVcs: [],
    descendantManaged: [],
    syncService: null,
    externalVolume: false,
    fileCount: 12,
    byteCount: 40_000,
    markdownCount: 12,
    scanTruncated: false,
    ...overrides,
  };
}

function root(path: string, kind: TrackedRoot["kind"] = "mirrored"): TrackedRoot {
  return { id: `root-${path}`, path, kind };
}

describe("evaluateSyncPreflight", () => {
  it("allows a plain Markdown folder with no warnings", () => {
    expect(evaluateSyncPreflight(facts(), [])).toEqual({
      verdict: "allow",
      refusal: null,
      warnings: [],
      excluded: [],
    });
  });

  it("refuses anything under version control and teaches the copy bridge", () => {
    const result = evaluateSyncPreflight(facts({
      canonicalPath: `${HOME}/code/repo/docs`,
      ancestorVcs: [{ path: `${HOME}/code/repo`, marker: ".git" }],
    }), []);
    expect(result.refusal?.code).toBe("version-control");
    expect(result.refusal?.message).toContain("Git owns the files in repo");
    expect(result.refusal?.message).toContain("copy a file into Notes");
  });

  it("refuses non-folders, packages, unwritable and protected locations", () => {
    expect(evaluateSyncPreflight(facts({ isDirectory: false }), []).refusal?.code).toBe("not-a-folder");
    expect(evaluateSyncPreflight(facts({ isPackage: true }), []).refusal?.code).toBe("package");
    expect(evaluateSyncPreflight(facts({ writable: false }), []).refusal?.code).toBe("not-writable");
    for (const path of [HOME, "/", `${HOME}/Library`, "/Applications", `${HOME}/.Trash`, `${HOME}/Library/Application Support/com.ghost.app`]) {
      expect(evaluateSyncPreflight(facts({ canonicalPath: path }), []).refusal?.code).toBe("protected-location");
    }
  });

  it("refuses folders that are, contain, or sit inside a synced root", () => {
    const roots = [root(`${HOME}/Ghost/Notes`), root(`${HOME}/code`, "plain")];
    expect(evaluateSyncPreflight(facts({ canonicalPath: `${HOME}/Ghost/Notes` }), roots).refusal?.code).toBe("already-synced");
    expect(evaluateSyncPreflight(facts({ canonicalPath: `${HOME}/Ghost/Notes/sub` }), roots).refusal?.code).toBe("inside-synced-root");
    const containing = evaluateSyncPreflight(facts({ canonicalPath: `${HOME}/Ghost` }), roots);
    expect(containing.refusal?.code).toBe("contains-synced-root");
    expect(containing.refusal?.message).toContain("Notes inside Ghost is already synced");
    expect(evaluateSyncPreflight(facts({ canonicalPath: `${HOME}/code/x` }), roots).verdict).toBe("allow");
  });

  it("excludes repositories and managed folders found inside, with their reasons", () => {
    const result = evaluateSyncPreflight(facts({
      descendantVcs: [{ path: `${HOME}/Cowork/lib`, marker: ".git" }],
      descendantManaged: [{ path: `${HOME}/Cowork/vault`, marker: ".obsidian" }],
    }), []);
    expect(result.verdict).toBe("allow");
    expect(result.excluded).toEqual([
      { path: `${HOME}/Cowork/lib`, marker: ".git", reason: "version-control" },
      { path: `${HOME}/Cowork/vault`, marker: ".obsidian", reason: "managed-folder" },
    ]);
  });

  it("warns about other sync services, external volumes, size, and non-Markdown files", () => {
    const result = evaluateSyncPreflight(facts({
      syncService: "Dropbox",
      externalVolume: true,
      fileCount: LARGE_FILE_COUNT + 5,
      markdownCount: 10,
      byteCount: 3 * 1024 ** 3,
    }), []);
    expect(result.verdict).toBe("allow");
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      "other-sync-service",
      "external-volume",
      "very-large",
      "non-markdown-files",
    ]);
    expect(result.warnings[0].message).toContain("Dropbox");
    expect(result.warnings[2].message).toContain("3.0 GB");
    expect(result.warnings[3].message).toContain("won't sync yet");

    const vault = evaluateSyncPreflight(facts({
      ancestorManaged: [{ path: `${HOME}/Cowork`, marker: ".obsidian" }],
    }), []);
    expect(vault.warnings[0].message).toContain("Obsidian");
  });
});

describe("resolveMirroredRoot", () => {
  function fakeFs(overrides: Partial<RootResolutionFs> = {}): RootResolutionFs {
    return {
      resolveBookmark: async () => { throw new Error("no bookmark"); },
      isDirectory: async () => false,
      inspect: async () => ({ ancestorVcs: [], ancestorManaged: [], syncService: null }),
      mountedVolumes: async () => [],
      ...overrides,
    };
  }

  it("follows the bookmark to a moved folder", async () => {
    const result = await resolveMirroredRoot(
      { id: "r", path: `${HOME}/Cowork`, kind: "mirrored", bookmark: "bm" },
      fakeFs({
        resolveBookmark: async () => ({ path: `${HOME}/Work/Cowork`, stale: false }),
        isDirectory: async (path) => path === `${HOME}/Work/Cowork`,
      }),
    );
    expect(result).toEqual({ kind: "ok", path: `${HOME}/Work/Cowork`, moved: true, bookmarkStale: false });
  });

  it("falls back to the remembered path and flags the bookmark as stale", async () => {
    const result = await resolveMirroredRoot(
      { id: "r", path: `${HOME}/Cowork`, kind: "mirrored", bookmark: "bm" },
      fakeFs({ isDirectory: async (path) => path === `${HOME}/Cowork` }),
    );
    expect(result).toEqual({ kind: "ok", path: `${HOME}/Cowork`, moved: false, bookmarkStale: true });
  });

  it("pauses a folder that was dragged into a repository", async () => {
    const result = await resolveMirroredRoot(
      { id: "r", path: `${HOME}/code/repo/Cowork`, kind: "mirrored" },
      fakeFs({
        isDirectory: async () => true,
        inspect: async () => ({
          ancestorVcs: [{ path: `${HOME}/code/repo`, marker: ".git" }],
          ancestorManaged: [],
          syncService: null,
        }),
      }),
    );
    expect(result.kind).toBe("paused");
    if (result.kind === "paused") expect(result.reason).toContain("inside a Git repository (repo)");
  });

  it("distinguishes an unmounted volume from a missing folder", async () => {
    const unmounted = await resolveMirroredRoot(
      { id: "r", path: "/Volumes/Archive/Notes", kind: "mirrored" },
      fakeFs({ mountedVolumes: async () => ["Macintosh HD"] }),
    );
    expect(unmounted).toEqual({ kind: "unavailable", path: "/Volumes/Archive/Notes" });

    const missing = await resolveMirroredRoot(
      { id: "r", path: "/Volumes/Archive/Notes", kind: "mirrored" },
      fakeFs({ mountedVolumes: async () => ["Archive"] }),
    );
    expect(missing).toEqual({ kind: "missing", path: "/Volumes/Archive/Notes" });
    expect(volumeOf(`${HOME}/x`)).toBeNull();
  });
});
