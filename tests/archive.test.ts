import { describe, expect, it } from "vitest";
import {
  allDirectoryIds,
  archiveContainerLabel,
  archiveFormatLabel,
  buildArchiveTree,
  flattenArchiveTree,
  type ArchiveEntry,
} from "../src/lib/archive";
import {
  ARCHIVE_MEDIA_PREVIEW_MAX_BYTES,
  archivePreviewLimitForPath,
} from "../src/lib/archive-preview-policy";

const entries: ArchiveEntry[] = [
  { path: "README.md", kind: "file", size_bytes: 12, modified_ms: 1, link_target: null },
  { path: "Sources/App.swift", kind: "file", size_bytes: 42, modified_ms: 2, link_target: null },
  { path: "Sources/Assets/icon.png", kind: "file", size_bytes: 80, modified_ms: 3, link_target: null },
  { path: "latest", kind: "symlink", size_bytes: 0, modified_ms: 4, link_target: "Sources" },
];

describe("archive utilities", () => {
  it("preflights known entry types before materialization", () => {
    expect(archivePreviewLimitForPath("customers.csv")).toBe(ARCHIVE_MEDIA_PREVIEW_MAX_BYTES);
    expect(archivePreviewLimitForPath("scan.tiff")).toBe(ARCHIVE_MEDIA_PREVIEW_MAX_BYTES);
    expect(archivePreviewLimitForPath("recording.flac")).toBe(ARCHIVE_MEDIA_PREVIEW_MAX_BYTES);
  });

  it("labels compound archive extensions before simple ones", () => {
    expect(archiveFormatLabel("backup.TAR.GZ")).toBe("GZIP TAR");
    expect(archiveFormatLabel("backup.tbz2")).toBe("BZIP2 TAR");
    expect(archiveFormatLabel("backup.7z")).toBe("7-ZIP");
    expect(archiveFormatLabel("photo.gz")).toBe("GZIP");
    expect(archiveFormatLabel("photo.bz2")).toBe("BZIP2");
    expect(archiveContainerLabel("photo.gz")).toBe("GZIP stream");
    expect(archiveContainerLabel("backup.tar.gz")).toBe("GZIP TAR archive");
  });

  it("infers parent folders and flattens only expanded branches", () => {
    const roots = buildArchiveTree(entries);
    expect(roots.map((node) => node.name)).toEqual(["Sources", "latest", "README.md"]);
    expect(roots[0].implicit).toBe(true);

    const collapsed = flattenArchiveTree(roots, new Set());
    expect(collapsed.map(({ node }) => node.path)).toEqual(["Sources", "latest", "README.md"]);

    const expanded = flattenArchiveTree(roots, new Set(["directory:Sources"]));
    expect(expanded.map(({ node, depth }) => [node.path, depth])).toEqual([
      ["Sources", 0],
      ["Sources/Assets", 1],
      ["Sources/App.swift", 1],
      ["latest", 0],
      ["README.md", 0],
    ]);
  });

  it("keeps duplicate file entries visible", () => {
    const roots = buildArchiveTree([...entries, entries[0]]);
    expect(roots.filter((node) => node.path === "README.md")).toHaveLength(2);
  });

  it("collects all inferred directory ids for expand all", () => {
    expect([...allDirectoryIds(buildArchiveTree(entries))].sort()).toEqual([
      "directory:Sources",
      "directory:Sources/Assets",
    ]);
  });
});
