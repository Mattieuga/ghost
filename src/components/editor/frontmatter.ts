import type { Editor, JSONContent } from "@tiptap/core";
import "@tiptap/markdown";

/** Matches a YAML frontmatter block only at the absolute start of a document. */
export const FRONTMATTER_PATTERN = /^\uFEFF?---[ \t]*(?:\r\n|\n)(?:(?!(?:---|\.\.\.)[ \t]*(?=(?:\r\n|\n|$)))[^\r\n]*(?:\r\n|\n))*(?:---|\.\.\.)[ \t]*(?=(?:\r\n|\n)|$)/;

export interface SplitFrontmatter {
  raw: string;
  body: string;
}

export interface FrontmatterSource {
  opening: string;
  openingEol: "\n" | "\r\n";
  yaml: string;
  closingEol: "\n" | "\r\n" | "";
  closing: string;
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
 * Split a validated raw frontmatter node into its structural delimiters and
 * editable YAML. Keeping those pieces separate prevents the editor UI from
 * accidentally turning the block into ordinary Markdown.
 */
export function parseFrontmatterSource(raw: string): FrontmatterSource | null {
  const match = raw.match(
    /^(\uFEFF?---[ \t]*)(\r\n|\n)([\s\S]*?)(?:(\r\n|\n))?((?:---|\.\.\.)[ \t]*)$/,
  );
  if (!match) return null;

  return {
    opening: match[1],
    openingEol: match[2] as "\n" | "\r\n",
    yaml: match[3],
    closingEol: (match[4] ?? "") as "\n" | "\r\n" | "",
    closing: match[5],
  };
}

/** Replace only the YAML payload while retaining the source block's format. */
export function replaceFrontmatterYaml(raw: string, yaml: string): string {
  const source = parseFrontmatterSource(raw);
  if (!source) return raw;

  const normalizedYaml = yaml.replace(/\r\n|\r|\n/g, source.openingEol);
  const closingEol = normalizedYaml ? source.closingEol || source.openingEol : "";

  return (
    source.opening +
    source.openingEol +
    normalizedYaml +
    closingEol +
    source.closing
  );
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
