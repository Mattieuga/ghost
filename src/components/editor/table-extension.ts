import type { JSONContent } from "@tiptap/core";
import { Table, renderTableToMarkdown } from "@tiptap/extension-table";

function tableWidths(node: JSONContent) {
  return node.content?.map((row) =>
    row.content?.map((cell) => Array.isArray(cell.attrs?.colwidth) ? cell.attrs.colwidth : null) ?? [],
  ) ?? [];
}

/**
 * Keep table content in normal GFM Markdown so links and inline formatting
 * survive. A small Ghost comment carries presentation-only column widths and
 * is reapplied by parseMarkdownDocument when the file is reopened.
 */
export const ResizableTable = Table.extend({
  renderMarkdown(node, helpers) {
    const hasCustomWidths = node.content?.some((row) =>
      row.content?.some((cell) => {
        const colwidth = cell.attrs?.colwidth;
        return Array.isArray(colwidth) &&
          colwidth.some((width: number | null) => width !== null && width > 0);
      })
    );

    const markdown = renderTableToMarkdown(node, helpers);
    if (!hasCustomWidths) return markdown;

    return `<!-- ghost-table-widths:${JSON.stringify(tableWidths(node))} -->\n${markdown}`;
  },
});
