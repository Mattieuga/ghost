// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import Link from "@tiptap/extension-link";
import { TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { FindAndReplace } from "@tiptap/extension-find-and-replace";
import { Markdown } from "@tiptap/markdown";
import { Frontmatter } from "../src/components/editor/frontmatter-extension";
import {
  parseFrontmatterSource,
  parseMarkdownDocument,
  replaceFrontmatterYaml,
} from "../src/components/editor/frontmatter";
import { ResizableImage } from "../src/components/editor/image-extension";
import { ResizableTable } from "../src/components/editor/table-extension";

const editors: Editor[] = [];

function createEditor(markdown: string, onUpdate?: () => void): Editor {
  const editor = new Editor({
    extensions: [
      StarterKit.configure({ link: false, trailingNode: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Link.configure({ openOnClick: false }),
      ResizableImage.configure({ allowBase64: true }),
      ResizableTable.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      Frontmatter,
      FindAndReplace.configure({ injectCSS: false, searchDebounceMs: 0 }),
      Markdown.configure({
        indentation: { style: "space", size: 2 },
        markedOptions: { gfm: true },
      }),
    ],
    content: "",
    ...(onUpdate ? { onUpdate } : {}),
  });

  editor.commands.setContent(parseMarkdownDocument(editor, markdown), { emitUpdate: false });
  editors.push(editor);
  return editor;
}

function roundTrip(markdown: string): string {
  return createEditor(markdown).getMarkdown();
}

afterEach(() => {
  while (editors.length) editors.pop()?.destroy();
});

describe("Tiptap 3 Markdown", () => {
  it("preserves YAML frontmatter as one raw node", () => {
    const frontmatter =
      "---\n" +
      "# keep this comment\n" +
      "title: \"Chili: the sequel\"\n" +
      "time: 60–75 min\n" +
      "tags: [soup, winter]\n" +
      "---";
    const editor = createEditor(`${frontmatter}\n\n# Recipe\n`);

    expect(editor.getJSON().content?.[0]).toMatchObject({
      type: "frontmatter",
      attrs: { raw: frontmatter },
    });
    expect(editor.getMarkdown()).toBe(`${frontmatter}\n\n# Recipe`);
  });

  it.each([
    ["CRLF and document end", "---\r\ntitle: Chili\r\n---"],
    ["BOM and alternate close", "\uFEFF---\nquoted: 'yes'\n..."],
    ["empty block", "---\n---"],
  ])("preserves %s frontmatter byte-for-byte", (_label, frontmatter) => {
    const editor = createEditor(frontmatter);
    expect(editor.getJSON().content?.[0]?.attrs?.raw).toBe(frontmatter);
    expect(editor.getMarkdown()).toBe(frontmatter);
  });

  it("edits only YAML while preserving frontmatter delimiters and line endings", () => {
    const raw = "\uFEFF---  \r\ntitle: Chili\r\n...  ";

    expect(parseFrontmatterSource(raw)).toEqual({
      opening: "\uFEFF---  ",
      openingEol: "\r\n",
      yaml: "title: Chili",
      closingEol: "\r\n",
      closing: "...  ",
    });
    expect(replaceFrontmatterYaml(raw, "title: Soup\n# keep comment")).toBe(
      "\uFEFF---  \r\ntitle: Soup\r\n# keep comment\r\n...  ",
    );
    expect(replaceFrontmatterYaml(raw, "")).toBe("\uFEFF---  \r\n...  ");
  });

  it("does not reinterpret a delimiter block in the middle of a document as frontmatter", () => {
    const editor = createEditor("# Heading\n\n---\nvalue: ordinary text\n---\n");
    expect(editor.getJSON().content?.some((node) => node.type === "frontmatter")).toBe(false);
  });

  it("does not emit an update while initial Markdown is loaded explicitly", () => {
    const onUpdate = vi.fn();
    const editor = createEditor("", onUpdate);
    editor.commands.setContent(parseMarkdownDocument(editor, "# Loaded"), {
      emitUpdate: false,
    });
    expect(onUpdate).not.toHaveBeenCalled();
    expect(editor.getMarkdown().trimEnd()).toBe("# Loaded");
  });

  it("round-trips the rich structures Ghost relies on", () => {
    const output = roundTrip(
      "# Heading\n\n" +
      "A **bold** and *italic* paragraph with [a link](https://example.com).\n\n" +
      "> A quote\n\n" +
      "- one\n" +
      "  - nested\n\n" +
      "3. three\n" +
      "4. four\n\n" +
      "- [ ] todo\n" +
      "- [x] done\n\n" +
      "```ts\nconst value = 1;\n```\n",
    );

    expect(output).toContain("# Heading");
    expect(output).toContain("**bold**");
    expect(output).toContain("*italic*");
    expect(output).toContain("[a link](https://example.com)");
    expect(output).toContain("> A quote");
    expect(output).toContain("  - nested");
    expect(output).toContain("3. three\n4. four");
    expect(output).toContain("- [ ] todo\n- [x] done");
    expect(output).toContain("```ts\nconst value = 1;\n```");
  });

  it("keeps ordinary tables as GFM pipe tables", () => {
    const output = roundTrip(
      "| Name | Value |\n" +
      "| --- | ---: |\n" +
      "| Alpha | 1 |\n",
    );

    expect(output).toContain("| Name");
    expect(output).toContain("| ---");
    expect(output).not.toContain("<table>");
  });

  it("keeps resized tables in Markdown, preserves inline formatting, and restores widths", () => {
    const editor = createEditor(
      "| **Name** | [Value](https://example.com) |\n" +
      "| --- | --- |\n" +
      "| Alpha | 1 |\n",
    );
    let firstCellPos: number | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (firstCellPos === null && node.type.name === "tableHeader") {
        firstCellPos = pos;
        return false;
      }
    });
    expect(firstCellPos).not.toBeNull();
    const cell = editor.state.doc.nodeAt(firstCellPos!);
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(firstCellPos!, undefined, {
        ...cell?.attrs,
        colwidth: [180],
      }),
    );

    const output = editor.getMarkdown();
    expect(output).toContain("<!-- ghost-table-widths:");
    expect(output).toContain("| **Name**");
    expect(output).toContain("[Value](https://example.com)");
    expect(output).not.toContain("<table>");

    const reopened = createEditor(output);
    let restoredWidth: number[] | null = null;
    reopened.state.doc.descendants((node) => {
      if (restoredWidth === null && node.type.name === "tableHeader") {
        restoredWidth = node.attrs.colwidth;
        return false;
      }
    });
    expect(restoredWidth).toEqual([180]);
  });

  it("migrates legacy resized HTML tables without losing rich cell content", () => {
    const legacy =
      '<table><thead><tr><th colwidth="180"><strong>Name</strong></th>' +
      '<th><a href="https://example.com">Value</a></th></tr></thead>' +
      '<tbody><tr><td>Alpha</td><td>1</td></tr></tbody></table>';
    const editor = createEditor(legacy);

    let restoredWidth: number[] | null = null;
    editor.state.doc.descendants((node) => {
      if (restoredWidth === null && node.type.name === "tableHeader") {
        restoredWidth = node.attrs.colwidth;
        return false;
      }
    });

    expect(restoredWidth).toEqual([180]);
    const output = editor.getMarkdown();
    expect(output).toContain("<!-- ghost-table-widths:");
    expect(output).toContain("**Name**");
    expect(output).toContain("[Value](https://example.com)");
    expect(output).not.toContain("<table>");
  });

  it("round-trips Markdown images and uses HTML when an image is resized", () => {
    const editor = createEditor('![Diagram](./diagram.png "Architecture")');
    expect(editor.getMarkdown()).toContain('![Diagram](./diagram.png "Architecture")');

    let imagePos: number | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "image") {
        imagePos = pos;
        return false;
      }
    });
    expect(imagePos).not.toBeNull();
    const image = editor.state.doc.nodeAt(imagePos!);
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(imagePos!, undefined, {
        ...image?.attrs,
        width: 420,
      }),
    );

    expect(editor.getMarkdown()).toContain(
      '<img src="./diagram.png" alt="Diagram" title="Architecture" width="420">',
    );
  });

  it("finds, navigates, replaces, and replaces all through the official extension", () => {
    const editor = createEditor("Alpha beta alpha.\n\nAnother alpha.");
    editor.commands.setSearchTerm("alpha");
    expect(editor.storage.findAndReplace.results).toHaveLength(3);
    expect(editor.storage.findAndReplace.currentIndex).toBe(0);

    editor.commands.goToNextResult();
    expect(editor.storage.findAndReplace.currentIndex).toBe(1);

    editor.commands.setReplaceTerm("omega");
    editor.commands.replace();
    expect(editor.getText()).toContain("Alpha beta omega.");

    editor.commands.replaceAll();
    expect(editor.getText().toLowerCase()).not.toContain("alpha");
    expect(editor.getText().match(/omega/g)).toHaveLength(3);
  });
});
