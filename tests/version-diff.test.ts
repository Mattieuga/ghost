// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/core";
import { diffMarkdownVersions, hasDiffMarks } from "../src/lib/version-diff";
import { dedupeVersions, type HistoryVersion } from "../src/components/editor/version-history-sidebar";

function marked(node: JSONContent, mark: string): string[] {
  const out: string[] = [];
  const walk = (n: JSONContent) => {
    if (n.type === "text" && n.marks?.some((m) => m.type === mark)) out.push(n.text ?? "");
    for (const child of n.content ?? []) walk(child);
  };
  walk(node);
  return out;
}

describe("version diff", () => {
  it("marks changed words inside a paragraph and whole blocks that came or went", () => {
    const before = "# Title\n\nThe quick brown fox.\n\nGone entirely.\n";
    const after = "# Title\n\nThe quick red fox jumps.\n\nBrand new paragraph.\n";
    const doc = diffMarkdownVersions(before, after);

    expect(hasDiffMarks(doc)).toBe(true);
    expect(marked(doc, "diffDelete").join("|")).toBe("brown|Gone entirely.");
    expect(marked(doc, "diffInsert").join("|")).toBe("red| jumps|Brand new paragraph.");
    // The unchanged heading is untouched, and the removed paragraph stays in place.
    const visible = (block: JSONContent) => (block.content ?? [])
      .filter((n) => !n.marks?.some((m) => m.type === "diffDelete"))
      .map((n) => n.text ?? "").join("");
    expect((doc.content ?? []).map(visible)).toEqual(["Title", "The quick red fox jumps.", "", "Brand new paragraph."]);
  });

  it("shows a block that changed shape as removed then added", () => {
    const doc = diffMarkdownVersions("- one\n- two\n", "1. one\n2. two\n");
    expect(doc.content?.map((block) => block.type)).toEqual(["bulletList", "orderedList"]);
    expect(marked(doc, "diffDelete")).toEqual(["one", "two"]);
    expect(marked(doc, "diffInsert")).toEqual(["one", "two"]);
  });

  it("has no marks when nothing changed, and none for the first version", () => {
    expect(hasDiffMarks(diffMarkdownVersions("# Same\n", "# Same\n"))).toBe(false);
    expect(hasDiffMarks(diffMarkdownVersions(null, "# First\n"))).toBe(false);
  });
});

describe("dedupeVersions", () => {
  it("lists a version captured both locally and in Cloud once, newest first", () => {
    const versions: HistoryVersion[] = [
      { id: "l1", createdAt: "2026-09-07T10:00:00Z", reason: "automatic", source: "local", markdown: "# a" },
      { id: "c1", createdAt: "2026-09-07T10:00:03Z", reason: "automatic", source: "cloud", markdown: "# a" },
      { id: "c2", createdAt: "2026-09-07T11:00:00Z", reason: "restore", source: "cloud", markdown: "# b" },
    ];
    const result = dedupeVersions(versions);
    expect(result.map((version) => version.id)).toEqual(["c2", "l1"]);
  });
});
