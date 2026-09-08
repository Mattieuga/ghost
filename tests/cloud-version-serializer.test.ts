import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const captureSource = readFileSync(
  new URL("../src/cloud/use-cloud-version-capture.ts", import.meta.url),
  "utf8",
);
const restoreSource = readFileSync(
  new URL("../src/components/editor/version-history.ts", import.meta.url),
  "utf8",
);

describe("Cloud version history Markdown paths", () => {
  it("snapshots and restores through the shared parser and serializer", () => {
    // Local files already go through these. Cloud snapshots must too, or the
    // checkpoint taken to protect a document is the lossy copy.
    expect(captureSource).toContain("serializeMarkdownDocument(editor)");
    expect(restoreSource).toContain("parseMarkdownDocument(deps.editor, version.markdown)");
    expect(restoreSource).toContain("applyDocumentAsBlockDiff(");
    for (const source of [captureSource, restoreSource]) {
      expect(source).not.toContain("getMarkdown()");
      expect(source).not.toContain('contentType: "markdown"');
    }
  });
});
