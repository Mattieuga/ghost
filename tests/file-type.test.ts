import { describe, expect, it } from "vitest";
import { isMarkdown, isTextEditable, requiresMarkdownSourceMode } from "../src/lib/file-type";

describe("Markdown editing mode selection", () => {
  it("opens MDX in source mode instead of the rich Markdown editor", () => {
    expect(isMarkdown("component.mdx")).toBe(false);
    expect(isTextEditable("component.mdx")).toBe(true);
    expect(requiresMarkdownSourceMode("component.mdx", "# Hello\n\n<Component />")).toBe(true);
  });

  it("keeps ordinary Markdown in the rich editor", () => {
    expect(requiresMarkdownSourceMode("notes.md", "# Hello\n\nPlain **Markdown**.")).toBe(false);
  });

  it.each([
    ["custom HTML", "Before\n\n<details><summary>More</summary>Hidden</details>"],
    ["ordinary comments", "Before\n\n<!-- preserve this exact comment -->"],
  ])("uses source mode for %s", (_label, content) => {
    expect(requiresMarkdownSourceMode("notes.md", content)).toBe(true);
  });

  it("ignores HTML examples inside fenced code", () => {
    const content = "```html\n<details><summary>Example</summary></details>\n```";
    expect(requiresMarkdownSourceMode("notes.md", content)).toBe(false);
  });

  it("allows Ghost-owned image and table metadata in the rich editor", () => {
    expect(
      requiresMarkdownSourceMode("notes.md", '<img src="./image.png" alt="" width="420">'),
    ).toBe(false);
    expect(
      requiresMarkdownSourceMode(
        "notes.md",
        '<!-- ghost-table-widths:[[[180],[null]],[[180],[null]]] -->\n' +
          "| Name | Value |\n| --- | --- |\n| Alpha | 1 |",
      ),
    ).toBe(false);
  });

  it.each([
    ["malformed table metadata", '<!-- ghost-table-widths:[not-json] -->\n| A |\n| --- |'],
    ["invalid table widths", '<!-- ghost-table-widths:[[[-1]]] -->\n| A |\n| --- |'],
    ["custom image attributes", '<img src="./image.png" width="420" class="framed">'],
    ["unresized HTML images", '<img src="./image.png" alt="Diagram">'],
    ["custom legacy table attributes", '<table class="data"><tr><td>A</td></tr></table>'],
  ])("keeps %s in source mode", (_label, content) => {
    expect(requiresMarkdownSourceMode("notes.md", content)).toBe(true);
  });

  it("allows only the legacy table HTML Ghost can migrate safely", () => {
    const legacy =
      '<table><tr><th colwidth="180"><strong>Name</strong></th>' +
      '<th><a href="https://example.com" title="Value">Value</a></th></tr></table>';
    expect(requiresMarkdownSourceMode("notes.md", legacy)).toBe(false);
  });
});
