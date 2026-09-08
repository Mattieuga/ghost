import type { JSONContent } from "@tiptap/core";
import { DIFF_DELETE, DIFF_INSERT } from "@/components/editor/diff-marks";
import { parseMarkdownDocument } from "@/components/editor/frontmatter";
import { createHeadlessMarkdownEditor } from "@/components/editor/markdown-schema";
import { blockKeys, diffHunks } from "@/lib/mirror/three-way-merge";

/**
 * A document that shows what one version changed against the one before
 * it, the way a shared document's history does: text the version added is
 * marked as inserted, text it removed is kept in place and marked as
 * deleted. Blocks are diffed first; a block that changed a little is diffed
 * word by word, one that changed shape is shown removed then added.
 */

/** Inline-carrying block types where a word diff reads well. */
const INLINE_BLOCKS = new Set(["paragraph", "heading", "blockquote"]);

function cloneWithMark(node: JSONContent, mark: string): JSONContent {
  if (node.type === "text") {
    const marks = (node.marks ?? []).filter((existing) => existing.type !== DIFF_INSERT && existing.type !== DIFF_DELETE);
    return { ...node, marks: [...marks, { type: mark }] };
  }
  return {
    ...node,
    ...(node.content ? { content: node.content.map((child) => cloneWithMark(child, mark)) } : {}),
  };
}

function blockText(block: JSONContent): string {
  if (block.type === "text") return block.text ?? "";
  if (block.type === "hardBreak") return "\n";
  return (block.content ?? []).map(blockText).join(block.type === "paragraph" ? "" : "\n");
}

/** Words, punctuation, and the spaces between them, so a diff never splits a word. */
function tokens(text: string): string[] {
  return text.match(/\s+|[\p{L}\p{N}_'’]+|[^\s\p{L}\p{N}_'’]+/gu) ?? [];
}

function inlineContent(text: string, mark: string | null): JSONContent[] {
  if (!text) return [];
  const parts = text.split("\n");
  const nodes: JSONContent[] = [];
  parts.forEach((part, index) => {
    if (index > 0) nodes.push({ type: "hardBreak" });
    if (part) nodes.push({ type: "text", text: part, ...(mark ? { marks: [{ type: mark }] } : {}) });
  });
  return nodes;
}

/** How alike two blocks are, 0 to 1, by shared words; punctuation does not count. */
function similarity(before: string, after: string): number {
  const words = (text: string) => tokens(text)
    .map((token) => token.replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase())
    .filter(Boolean);
  const a = words(before);
  const b = words(after);
  if (a.length === 0 && b.length === 0) return 1;
  const counts = new Map<string, number>();
  for (const token of a) counts.set(token, (counts.get(token) ?? 0) + 1);
  let shared = 0;
  for (const token of b) {
    const left = counts.get(token) ?? 0;
    if (left > 0) {
      shared += 1;
      counts.set(token, left - 1);
    }
  }
  return (2 * shared) / (a.length + b.length);
}

/** One block whose text changed a little: the new block's shape, with inline marks. */
function wordDiffBlock(before: JSONContent, after: JSONContent): JSONContent {
  const beforeTokens = tokens(blockText(before));
  const afterTokens = tokens(blockText(after));
  const content: JSONContent[] = [];
  let i = 0;
  let j = 0;
  for (const hunk of diffHunks(beforeTokens, afterTokens)) {
    content.push(...inlineContent(afterTokens.slice(j, hunk.otherStart).join(""), null));
    content.push(...inlineContent(beforeTokens.slice(hunk.baseStart, hunk.baseEnd).join(""), DIFF_DELETE));
    content.push(...inlineContent(afterTokens.slice(hunk.otherStart, hunk.otherEnd).join(""), DIFF_INSERT));
    i = hunk.baseEnd;
    j = hunk.otherEnd;
  }
  void i;
  content.push(...inlineContent(afterTokens.slice(j).join(""), null));
  const shell = after.type === "blockquote" ? after.content?.[0] ?? after : after;
  const merged = { ...shell, content };
  return after.type === "blockquote" ? { ...after, content: [merged] } : merged;
}

export function diffDocuments(before: JSONContent, after: JSONContent): JSONContent {
  const beforeBlocks = before.content ?? [];
  const afterBlocks = after.content ?? [];
  const hunks = diffHunks(blockKeys(beforeBlocks), blockKeys(afterBlocks));
  const content: JSONContent[] = [];
  let i = 0;
  let j = 0;
  for (const hunk of hunks) {
    content.push(...afterBlocks.slice(j, hunk.otherStart));
    const removed = beforeBlocks.slice(hunk.baseStart, hunk.baseEnd);
    const added = afterBlocks.slice(hunk.otherStart, hunk.otherEnd);
    // Pair removed and added blocks in order while they are alike enough
    // to read as edits; the rest is shown as removed, then added.
    let r = 0;
    let a = 0;
    while (r < removed.length && a < added.length) {
      const left = removed[r];
      const right = added[a];
      const alike = left.type === right.type
        && INLINE_BLOCKS.has(left.type ?? "")
        && similarity(blockText(left), blockText(right)) >= 0.5;
      if (alike) {
        content.push(wordDiffBlock(left, right));
        r += 1;
        a += 1;
      } else {
        break;
      }
    }
    for (const block of removed.slice(r)) content.push(cloneWithMark(block, DIFF_DELETE));
    for (const block of added.slice(a)) content.push(cloneWithMark(block, DIFF_INSERT));
    i = hunk.baseEnd;
    j = hunk.otherEnd;
  }
  void i;
  content.push(...afterBlocks.slice(j));
  return { ...after, content };
}

/** Parse two Markdown versions with the shared parser and diff them. */
export function diffMarkdownVersions(beforeMarkdown: string | null, afterMarkdown: string): JSONContent {
  const editor = createHeadlessMarkdownEditor();
  try {
    const after = parseMarkdownDocument(editor, afterMarkdown);
    if (beforeMarkdown === null) return after;
    const before = parseMarkdownDocument(editor, beforeMarkdown);
    return diffDocuments(before, after);
  } finally {
    editor.destroy();
  }
}

/** True when the diff contains any change at all. */
export function hasDiffMarks(node: JSONContent): boolean {
  if (node.marks?.some((mark) => mark.type === DIFF_INSERT || mark.type === DIFF_DELETE)) return true;
  return (node.content ?? []).some(hasDiffMarks);
}
