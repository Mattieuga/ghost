import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const panelSource = readFileSync(
  new URL("../src/cloud/cloud-version-history-panel.tsx", import.meta.url),
  "utf8",
);

describe("Cloud version history Markdown paths", () => {
  it("snapshots and restores through the shared parser and serializer", () => {
    // Local files already go through these. Cloud snapshots must too, or the
    // checkpoint taken to protect a document is the lossy copy.
    expect(panelSource).toContain("serializeMarkdownDocument(editor)");
    expect(panelSource).toContain("parseMarkdownDocument(editor, selected.markdown_snapshot)");
    expect(panelSource).not.toContain("getMarkdown()");
    expect(panelSource).not.toContain('contentType: "markdown"');
  });
});
