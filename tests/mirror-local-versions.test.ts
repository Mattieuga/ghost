import { describe, expect, it } from "vitest";
import {
  captureLocalVersion,
  listLocalVersions,
  localVersionName,
  LOCAL_VERSION_LIMIT,
  parseLocalVersionName,
  type LocalVersionFs,
} from "../src/lib/mirror/local-versions";

function memoryFs(): LocalVersionFs & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    ensureDir: async () => undefined,
    writeText: async (path, text) => { files.set(path, text); },
    readText: async (path) => {
      const text = files.get(path);
      if (text === undefined) throw new Error(`missing ${path}`);
      return text;
    },
    listFiles: async (dir) => Array.from(files.keys())
      .filter((path) => path.startsWith(`${dir}/`))
      .map((path) => path.slice(dir.length + 1)),
    removeFile: async (path) => { files.delete(path); },
  };
}

describe("local version history", () => {
  it("names versions so they sort by time and round-trip their reason", () => {
    const name = localVersionName(new Date("2026-09-02T14:03:22.123Z"), "external_write");
    expect(name).toBe("2026-09-02T14-03-22.123Z-external_write");
    expect(parseLocalVersionName(name)).toEqual({
      createdAt: "2026-09-02T14:03:22.123Z",
      reason: "external_write",
    });
    expect(parseLocalVersionName("notes.md")).toBeNull();
  });

  it("writes Markdown and Yjs snapshots under .ghost/versions and lists newest first", async () => {
    const fs = memoryFs();
    const first = await captureLocalVersion(fs, "/r", "doc-1", {
      reason: "automatic",
      markdown: "# One\n",
      yjsSnapshotBase64: "AAA=",
      now: new Date("2026-09-02T10:00:00.000Z"),
    });
    const second = await captureLocalVersion(fs, "/r", "doc-1", {
      reason: "external_write",
      markdown: "# Two\n",
      yjsSnapshotBase64: "BBB=",
      now: new Date("2026-09-02T11:00:00.000Z"),
    });

    expect(first?.markdownPath).toBe("/r/.ghost/versions/doc-1/2026-09-02T10-00-00.000Z-automatic.md");
    expect(fs.files.get(second!.yjsPath)).toBe("BBB=");
    const listed = await listLocalVersions(fs, "/r", "doc-1");
    expect(listed.map((version) => version.reason)).toEqual(["external_write", "automatic"]);
  });

  it("skips a version whose Markdown equals the newest one", async () => {
    const fs = memoryFs();
    await captureLocalVersion(fs, "/r", "doc-1", {
      reason: "automatic", markdown: "same", yjsSnapshotBase64: "A",
      now: new Date("2026-09-02T10:00:00.000Z"),
    });
    const duplicate = await captureLocalVersion(fs, "/r", "doc-1", {
      reason: "automatic", markdown: "same", yjsSnapshotBase64: "B",
      now: new Date("2026-09-02T10:05:00.000Z"),
    });
    expect(duplicate).toBeNull();
    expect(await listLocalVersions(fs, "/r", "doc-1")).toHaveLength(1);
  });

  it("prunes beyond the limit, oldest first", async () => {
    const fs = memoryFs();
    for (let index = 0; index < LOCAL_VERSION_LIMIT + 3; index += 1) {
      await captureLocalVersion(fs, "/r", "doc-1", {
        reason: "automatic",
        markdown: `version ${index}`,
        yjsSnapshotBase64: "A",
        now: new Date(Date.UTC(2026, 0, 1, 0, index)),
      });
    }
    const listed = await listLocalVersions(fs, "/r", "doc-1");
    expect(listed).toHaveLength(LOCAL_VERSION_LIMIT);
    expect(await fs.readText(listed.at(-1)!.markdownPath)).toBe("version 3");
    expect(fs.files.size).toBe(LOCAL_VERSION_LIMIT * 2);
  });
});
