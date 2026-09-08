import type { JSONContent } from "@tiptap/core";
import { DIFF_DELETE, DIFF_INSERT } from "@/components/editor/diff-marks";
import { parseMarkdownDocument } from "@/components/editor/frontmatter";
import { createHeadlessMarkdownEditor } from "@/components/editor/markdown-schema";
import { blockKeys, diffHunks } from "@/lib/mirror/three-way-merge";

/**
 * A document that shows what one version changed against the one before
 * it, the way a shared document's history does: text the version added is
 * marked as inserted, text it removed is kept in place and marked as
 * deleted. Blocks are diffed first; a container such as a list or a table
 * is diffed inside, so one changed item does not show the whole list
 * removed and added; a paragraph that changed a little is diffed word by
 * word, keeping its links and emphasis; one that changed shape is shown
 * removed then added.
 */

/** Blocks whose children are inline, where a word diff reads well. */
const INLINE_BLOCKS = new Set(["paragraph", "heading"]);

/** Blocks whose children are blocks of their own, diffed inside. */
const CONTAINER_BLOCKS = new Set([
  "blockquote", "bulletList", "orderedList", "taskList", "listItem", "taskItem",
  "table", "tableRow", "tableCell", "tableHeader",
]);

/** Words, punctuation, and the spaces between them, so a diff never splits a word. */
const TOKEN = /\s+|[\p{L}\p{N}_'’]+|[^\s\p{L}\p{N}_'’]+/gu;

type Mark = NonNullable<JSONContent["marks"]>[number];

/** One word, space, or punctuation run, with the marks it carries. */
interface Token {
  text: string;
  marks: Mark[];
}

function isDiffMark(mark: Mark): boolean {
  return mark.type === DIFF_INSERT || mark.type === DIFF_DELETE;
}

function cloneWithMark(node: JSONContent, mark: string): JSONContent {
  if (node.type === "text") {
    const marks = (node.marks ?? []).filter((existing) => !isDiffMark(existing));
    return { ...node, marks: [...marks, { type: mark }] };
  }
  return {
    ...node,
    ...(node.content ? { content: node.content.map((child) => cloneWithMark(child, mark)) } : {}),
  };
}

/** The inline run of a block, as tokens that keep their marks. A hard break is a token of its own. */
function tokensOf(block: JSONContent): Token[] {
  const tokens: Token[] = [];
  const walk = (node: JSONContent) => {
    if (node.type === "text") {
      const marks = (node.marks ?? []).filter((mark) => !isDiffMark(mark));
      for (const text of (node.text ?? "").match(TOKEN) ?? []) tokens.push({ text, marks });
      return;
    }
    if (node.type === "hardBreak") {
      tokens.push({ text: "\n", marks: [] });
      return;
    }
    for (const child of node.content ?? []) walk(child);
  };
  for (const child of block.content ?? []) walk(child);
  return tokens;
}

function sameMarks(left: Mark[], right: Mark[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Text nodes for a run of tokens, merged wherever the marks agree. */
function inlineContent(tokens: Token[], mark: string | null): JSONContent[] {
  const nodes: JSONContent[] = [];
  for (const token of tokens) {
    if (token.text === "\n") {
      nodes.push({ type: "hardBreak" });
      continue;
    }
    const marks = mark ? [...token.marks, { type: mark }] : token.marks;
    const last = nodes[nodes.length - 1];
    if (last && last.type === "text" && sameMarks(last.marks ?? [], marks)) {
      last.text += token.text;
    } else {
      nodes.push({ type: "text", text: token.text, ...(marks.length ? { marks } : {}) });
    }
  }
  return nodes;
}

/** How alike two inline blocks are, 0 to 1, by shared words; punctuation does not count. */
function similarity(before: Token[], after: Token[]): number {
  const words = (tokens: Token[]) => tokens
    .map((token) => token.text.replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase())
    .filter(Boolean);
  const a = words(before);
  const b = words(after);
  if (a.length === 0 && b.length === 0) return 1;
  const counts = new Map<string, number>();
  for (const word of a) counts.set(word, (counts.get(word) ?? 0) + 1);
  let shared = 0;
  for (const word of b) {
    const left = counts.get(word) ?? 0;
    if (left > 0) {
      shared += 1;
      counts.set(word, left - 1);
    }
  }
  return (2 * shared) / (a.length + b.length);
}

/** One inline block whose text changed a little: the new block's shape, with inline marks. */
function wordDiffBlock(before: Token[], after: Token[], shell: JSONContent): JSONContent {
  const content: JSONContent[] = [];
  let j = 0;
  for (const hunk of diffHunks(before.map((token) => token.text), after.map((token) => token.text))) {
    content.push(...inlineContent(after.slice(j, hunk.otherStart), null));
    content.push(...inlineContent(before.slice(hunk.baseStart, hunk.baseEnd), DIFF_DELETE));
    content.push(...inlineContent(after.slice(hunk.otherStart, hunk.otherEnd), DIFF_INSERT));
    j = hunk.otherEnd;
  }
  content.push(...inlineContent(after.slice(j), null));
  return { ...shell, content };
}

function diffBlocks(beforeBlocks: JSONContent[], afterBlocks: JSONContent[]): JSONContent[] {
  const hunks = diffHunks(blockKeys(beforeBlocks), blockKeys(afterBlocks));
  const content: JSONContent[] = [];
  let j = 0;
  for (const hunk of hunks) {
    content.push(...afterBlocks.slice(j, hunk.otherStart));
    const removed = beforeBlocks.slice(hunk.baseStart, hunk.baseEnd);
    const added = afterBlocks.slice(hunk.otherStart, hunk.otherEnd);
    // Pair removed and added blocks in order while they read as edits of
    // one another: a container of the same kind is diffed inside, an
    // inline block that kept most of its words is diffed word by word.
    // The rest is shown as removed, then added.
    let r = 0;
    let a = 0;
    while (r < removed.length && a < added.length) {
      const left = removed[r];
      const right = added[a];
      const type = left.type ?? "";
      if (type !== right.type) break;
      if (CONTAINER_BLOCKS.has(type)) {
        content.push({ ...right, content: diffBlocks(left.content ?? [], right.content ?? []) });
      } else if (INLINE_BLOCKS.has(type)) {
        const before = tokensOf(left);
        const after = tokensOf(right);
        if (similarity(before, after) < 0.5) break;
        content.push(wordDiffBlock(before, after, right));
      } else {
        break;
      }
      r += 1;
      a += 1;
    }
    for (const block of removed.slice(r)) content.push(cloneWithMark(block, DIFF_DELETE));
    for (const block of added.slice(a)) content.push(cloneWithMark(block, DIFF_INSERT));
    j = hunk.otherEnd;
  }
  content.push(...afterBlocks.slice(j));
  return content;
}

export function diffDocuments(before: JSONContent, after: JSONContent): JSONContent {
  return { ...after, content: diffBlocks(before.content ?? [], after.content ?? []) };
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
  if (node.marks?.some((mark) => isDiffMark(mark))) return true;
  return (node.content ?? []).some(hasDiffMarks);
}
