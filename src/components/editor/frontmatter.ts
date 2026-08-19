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

type TableCellWidth = Array<number | null> | null;
type TableWidthMatrix = TableCellWidth[][];

interface PreparedTableWidths {
  markdown: string;
  widthsByMarker: Map<string, TableWidthMatrix>;
}

function isTableWidthMatrix(value: unknown): value is TableWidthMatrix {
  return Array.isArray(value) && value.every((row) =>
    Array.isArray(row) && row.every((cell) =>
      cell === null || (Array.isArray(cell) && cell.every((width) =>
        width === null || (typeof width === "number" && Number.isFinite(width) && width > 0)
      ))
    )
  );
}

function prepareTableWidthMetadata(markdown: string): PreparedTableWidths {
  const eol = markdown.includes("\r\n") ? "\r\n" : "\n";
  const lines = markdown.split(/\r\n|\n/);
  const widthsByMarker = new Map<string, TableWidthMatrix>();
  let fence: { character: "`" | "~"; length: number } | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const fenceMatch = lines[index].match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const character = fenceMatch[1][0] as "`" | "~";
      if (!fence) {
        fence = { character, length: fenceMatch[1].length };
      } else if (fence.character === character && fenceMatch[1].length >= fence.length) {
        fence = null;
      }
      continue;
    }
    if (fence) continue;

    const metadata = lines[index].match(/^\s*<!--\s*ghost-table-widths:(\[.*\])\s*-->\s*$/);
    let headerIndex = index + 1;
    while (headerIndex < lines.length && lines[headerIndex].trim() === "") headerIndex += 1;
    const header = lines[headerIndex] ?? "";
    const delimiter = lines[headerIndex + 1] ?? "";
    if (!metadata || !header.includes("|") || !/^\s*\|?\s*:?-{3,}/.test(delimiter)) continue;

    try {
      const widths = JSON.parse(metadata[1]);
      if (!isTableWidthMatrix(widths)) continue;
      const marker = `GHOSTTABLEWIDTHSMARKER${widthsByMarker.size}END`;
      widthsByMarker.set(marker, widths);
      lines[index] = marker;
    } catch {
      // Leave malformed metadata untouched and let source-mode detection keep it safe.
    }
  }

  return { markdown: lines.join(eol), widthsByMarker };
}

function restoreTableWidths(document: JSONContent, widthsByMarker: Map<string, TableWidthMatrix>): JSONContent {
  if (widthsByMarker.size === 0 || !document.content) return document;

  const content: JSONContent[] = [];
  for (let index = 0; index < document.content.length; index += 1) {
    const node = document.content[index];
    const marker = node.type === "paragraph" && node.content?.length === 1
      && node.content[0].type === "text" ? node.content[0].text : null;
    const widths = marker ? widthsByMarker.get(marker) : undefined;
    const table = document.content[index + 1];

    if (widths && table?.type === "table") {
      content.push({
        ...table,
        content: table.content?.map((row, rowIndex) => ({
          ...row,
          content: row.content?.map((cell, cellIndex) => ({
            ...cell,
            attrs: {
              ...cell.attrs,
              colwidth: widths[rowIndex]?.[cellIndex] ?? null,
            },
          })),
        })),
      });
      index += 1;
      continue;
    }

    content.push(node);
  }

  return { ...document, content };
}

function parseMarkdownBody(editor: Editor, markdown: string): JSONContent {
  const prepared = prepareTableWidthMetadata(markdown);
  return restoreTableWidths(editor.markdown!.parse(prepared.markdown), prepared.widthsByMarker);
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
  if (!frontmatter) return parseMarkdownBody(editor, markdown);

  const bodyDocument = parseMarkdownBody(editor, frontmatter.body);
  return {
    type: "doc",
    content: [
      { type: "frontmatter", attrs: { raw: frontmatter.raw } },
      ...(bodyDocument.content ?? []),
    ],
  };
}
