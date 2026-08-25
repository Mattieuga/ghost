import { describe, expect, it } from "vitest";
import { Text } from "@codemirror/state";
import {
  retargetCompanionAssetDocument,
  retargetCompanionAssetReferences,
  retargetPath,
} from "../src/lib/file-path";

describe("retargetPath", () => {
  it("retargets an open file after that file is renamed", () => {
    expect(
      retargetPath("/notes/draft.md", "/notes/draft.md", "/notes/final.md"),
    ).toBe("/notes/final.md");
  });

  it("retargets an open descendant after its containing folder is renamed", () => {
    expect(
      retargetPath("/notes/project/draft.md", "/notes/project", "/notes/archive"),
    ).toBe("/notes/archive/draft.md");
  });

  it("does not retarget similarly prefixed sibling paths", () => {
    expect(
      retargetPath("/notes/project-old/draft.md", "/notes/project", "/notes/archive"),
    ).toBeNull();
  });
});

describe("retargetCompanionAssetReferences", () => {
  it("updates the live Markdown when a file stem and its assets folder are renamed", () => {
    expect(
      retargetCompanionAssetReferences(
        "![Diagram](draft.assets/diagram.png)",
        "/notes/draft.md",
        "/notes/final.md",
      ),
    ).toBe("![Diagram](final.assets/diagram.png)");
  });

  it("does not touch references when only the extension changes", () => {
    expect(
      retargetCompanionAssetReferences(
        "![Diagram](draft.assets/diagram.png)",
        "/notes/draft.md",
        "/notes/draft.markdown",
      ),
    ).toBe("![Diagram](draft.assets/diagram.png)");
  });

  it("retargets an immutable CodeMirror tree without changing the original", () => {
    const original = Text.of([
      "![One](draft.assets/one.png)",
      "![Two](draft.assets/two.png)",
    ]);
    const retargeted = retargetCompanionAssetDocument(
      original,
      "/notes/draft.md",
      "/notes/final.md",
    );

    expect(original.toString()).toContain("draft.assets");
    expect(retargeted.toString()).toBe(
      "![One](final.assets/one.png)\n![Two](final.assets/two.png)",
    );
  });
});
