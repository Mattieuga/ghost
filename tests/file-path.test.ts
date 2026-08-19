import { describe, expect, it } from "vitest";
import { retargetCompanionAssetReferences, retargetPath } from "../src/lib/file-path";

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
});
