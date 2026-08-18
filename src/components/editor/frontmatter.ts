import type { Editor, JSONContent } from "@tiptap/core";
import "@tiptap/markdown";

/** Matches a YAML frontmatter block only at the absolute start of a document. */
export const FRONTMATTER_PATTERN = /^\uFEFF?---[ \t]*(?:\r\n|\n)(?:(?!(?:---|\.\.\.)[ \t]*(?=(?:\r\n|\n|$)))[^\r\n]*(?:\r\n|\n))*(?:---|\.\.\.)[ \t]*(?=(?:\r\n|\n)|$)/;

export interface SplitFrontmatter {
  raw: string;
  body: string;
}

export function splitFrontmatter(markdown: string): SplitFrontmatter | null {
  const match = markdown.match(FRONTMATTER_PATTERN);
  if (!match) return null;
  return {
    raw: match[0],
    // The document renderer supplies the canonical blank line between this
    // block and the body. Do not turn the source separator into empty nodes.
    body: markdown.slice(match[0].length).replace(/^(?:(?:\r\n|\n)[ \t]*)+/, ""),
  };
}

/**
 * Parse a complete Markdown file while preserving frontmatter before Marked
 * normalizes line endings. The rest of the document still uses Tiptap's
 * official Markdown parser.
 */
export function parseMarkdownDocument(editor: Editor, markdown: string): JSONContent {
  if (!editor.markdown) {
    throw new Error("Markdown extension is not ready");
  }

  const frontmatter = splitFrontmatter(markdown);
  if (!frontmatter) return editor.markdown.parse(markdown);

  const bodyDocument = editor.markdown.parse(frontmatter.body);
  return {
    type: "doc",
    content: [
      { type: "frontmatter", attrs: { raw: frontmatter.raw } },
      ...(bodyDocument.content ?? []),
    ],
  };
}
