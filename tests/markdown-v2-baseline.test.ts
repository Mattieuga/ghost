// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Link from "@tiptap/extension-link";
import { Markdown } from "tiptap-markdown";

const editors: Editor[] = [];

function roundTrip(markdown: string): string {
  const editor = new Editor({
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      Link.configure({ openOnClick: false }),
      Markdown.configure({
        html: true,
        tightLists: true,
        bulletListMarker: "-",
      }),
    ],
    content: markdown,
  });

  editors.push(editor);
  return editor.storage.markdown.getMarkdown();
}

afterEach(() => {
  while (editors.length) editors.pop()?.destroy();
});

describe("the Tiptap 2 Markdown baseline", () => {
  it("captures the current destructive frontmatter behavior", () => {
    const output = roundTrip(
      "---\n" +
      "title: Chili\n" +
      "time: 60–75 min\n" +
      "category: soup\n" +
      "---\n\n" +
      "# Recipe\n",
    );

    expect(output).toBe(
      "---\n\n" +
      "## title: Chili time: 60–75 min category: soup\n\n" +
      "# Recipe",
    );
  });

  it("captures the current text escaping behavior", () => {
    expect(roundTrip("[unclear: note]\n\n~1/2 cup\n")).toBe(
      "\\[unclear: note\\]\n\n\\~1/2 cup",
    );
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
    expect(output).toContain("- [ ] todo\n\n- [x] done");
    expect(output).toContain("```ts\nconst value = 1;\n```");
  });
});
