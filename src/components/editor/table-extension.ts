import type { JSONContent } from "@tiptap/core";
import { Table, renderTableToMarkdown } from "@tiptap/extension-table";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function textContent(node: JSONContent): string {
  if (node.type === "text") return node.text ?? "";
  return node.content?.map(textContent).join("") ?? "";
}

function serializeTableToHtml(node: JSONContent): string {
  let html = "<table>\n";
  node.content?.forEach((row) => {
    html += "  <tr>\n";
    row.content?.forEach((cell) => {
      const tag = cell.type === "tableHeader" ? "th" : "td";
      const colwidth = cell.attrs?.colwidth;
      const widthAttr = Array.isArray(colwidth) ? ` colwidth="${colwidth.join(",")}"` : "";
      html += `    <${tag}${widthAttr}>${escapeHtml(textContent(cell))}</${tag}>\n`;
    });
    html += "  </tr>\n";
  });
  html += "</table>";
  return html;
}

/** Pipe tables remain readable Markdown; resized tables use HTML to retain widths. */
export const ResizableTable = Table.extend({
  renderMarkdown(node, helpers) {
    const hasCustomWidths = node.content?.some((row) =>
      row.content?.some((cell) => {
        const colwidth = cell.attrs?.colwidth;
        return Array.isArray(colwidth) &&
          colwidth.some((width: number | null) => width !== null && width > 0);
      })
    );

    return hasCustomWidths
      ? serializeTableToHtml(node)
      : renderTableToMarkdown(node, helpers);
  },
});
