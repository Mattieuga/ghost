// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { createHeadlessMarkdownEditor } from "../src/components/editor/markdown-schema";
import { parseMarkdownDocument } from "../src/components/editor/frontmatter";
import { serializeMarkdownDocument } from "../src/components/editor/markdown-source";
import { applyDocumentAsBlockDiff, computeBlockDiff } from "../src/lib/mirror/block-diff";

const editors: Editor[] = [];

function editorWith(markdown: string): Editor {
  const editor = createHeadlessMarkdownEditor();
  editor.commands.setContent(parseMarkdownDocument(editor, markdown), { emitUpdate: false });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  while (editors.length) editors.pop()?.destroy();
});

function applyMarkdown(editor: Editor, markdown: string) {
  return applyDocumentAsBlockDiff(editor, parseMarkdownDocument(editor, markdown));
}

describe("block-level diff apply", () => {
  it("replaces only the changed block and leaves the selection elsewhere alone", () => {
    const editor = editorWith("First paragraph.\n\nSecond paragraph.\n\nThird paragraph.\n");
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3)));

    const target = "First paragraph.\n\nSecond paragraph.\n\nThird paragraph, rewritten by an agent.\n";
    const diff = computeBlockDiff(
      editor.state.doc,
      editor.schema.nodeFromJSON(parseMarkdownDocument(editor, target)),
    );
    expect(diff?.unchangedPrefix).toBe(2);
    expect(diff?.unchangedSuffix).toBe(0);

    expect(applyMarkdown(editor, target)).toBe("applied");
    expect(serializeMarkdownDocument(editor)).toBe(target.trimEnd());
    expect(editor.state.selection.from).toBe(3);
  });

  it("reports an identical document as unchanged without dispatching", () => {
    const editor = editorWith("# Title\n\nBody.\n");
    let transactions = 0;
    editor.on("transaction", () => { transactions += 1; });
    expect(applyMarkdown(editor, "# Title\n\nBody.\n")).toBe("unchanged");
    expect(transactions).toBe(0);
  });

  it("inserts and deletes blocks in the middle", () => {
    const editor = editorWith("A\n\nC\n");
    expect(applyMarkdown(editor, "A\n\nB\n\nC\n")).toBe("applied");
    expect(serializeMarkdownDocument(editor)).toBe("A\n\nB\n\nC");
    expect(applyMarkdown(editor, "A\n\nC\n")).toBe("applied");
    expect(serializeMarkdownDocument(editor)).toBe("A\n\nC");
  });

  it("keeps frontmatter and table widths through a diff", () => {
    const editor = editorWith("---\ntitle: Plan\n---\n\nIntro.\n");
    const target = "---\ntitle: Plan\nstatus: draft\n---\n\nIntro.\n\n"
      + "<!-- ghost-table-widths:[[[120],[80]],[[120],[80]]] -->\n"
      + "| a | b |\n| --- | --- |\n| 1 | 2 |\n";
    expect(applyMarkdown(editor, target)).toBe("applied");
    const output = serializeMarkdownDocument(editor);
    expect(output).toContain("status: draft");
    expect(output).toContain("ghost-table-widths:[[[120],[80]],[[120],[80]]]");
    expect(output).toContain("| 1");
  });

  it("marks its transaction so history and mirror writers can recognise it", () => {
    const editor = editorWith("Old.\n");
    let seen: unknown = null;
    editor.on("transaction", ({ transaction }) => {
      seen = transaction.getMeta("ghost-block-diff") ?? seen;
    });
    applyMarkdown(editor, "New.\n");
    expect(seen).toBe(true);
  });
});
