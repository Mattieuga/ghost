import type { Editor, JSONContent } from "@tiptap/core";
import { Fragment, type Node as ProseMirrorNode } from "@tiptap/pm/model";

export interface BlockDiff {
  /** Document position where the changed run of top-level blocks starts. */
  from: number;
  /** Document position where the changed run ends. */
  to: number;
  /** Target blocks that replace the run. May be empty for a pure deletion. */
  replacement: Fragment;
  unchangedPrefix: number;
  unchangedSuffix: number;
}

/**
 * Compare two documents block by block and return the smallest run of
 * top-level blocks that must be replaced to turn `current` into `target`, or
 * null when they are already equal.
 */
export function computeBlockDiff(
  current: ProseMirrorNode,
  target: ProseMirrorNode,
): BlockDiff | null {
  const currentCount = current.childCount;
  const targetCount = target.childCount;

  let prefix = 0;
  while (
    prefix < currentCount
    && prefix < targetCount
    && current.child(prefix).eq(target.child(prefix))
  ) {
    prefix += 1;
  }
  if (prefix === currentCount && prefix === targetCount) return null;

  let suffix = 0;
  while (
    suffix < currentCount - prefix
    && suffix < targetCount - prefix
    && current.child(currentCount - 1 - suffix).eq(target.child(targetCount - 1 - suffix))
  ) {
    suffix += 1;
  }

  let from = 0;
  for (let index = 0; index < prefix; index += 1) from += current.child(index).nodeSize;
  let to = current.content.size;
  for (let index = 0; index < suffix; index += 1) {
    to -= current.child(currentCount - 1 - index).nodeSize;
  }

  const replacement: ProseMirrorNode[] = [];
  for (let index = prefix; index < targetCount - suffix; index += 1) {
    replacement.push(target.child(index));
  }

  return {
    from,
    to,
    replacement: Fragment.from(replacement),
    unchangedPrefix: prefix,
    unchangedSuffix: suffix,
  };
}

/**
 * Replace only the changed top-level blocks in one transaction. Under
 * collaboration this becomes Yjs operations on that range alone, so other
 * collaborators' cursors outside it stay put and history stays readable.
 * Whole-document `setContent` is a delete-all plus insert-all and must not be
 * used on a collaborative document.
 */
export function applyDocumentAsBlockDiff(
  editor: Editor,
  target: JSONContent,
  options: { addToHistory?: boolean } = {},
): "unchanged" | "applied" {
  const targetNode = editor.schema.nodeFromJSON(target);
  const diff = computeBlockDiff(editor.state.doc, targetNode);
  if (!diff) return "unchanged";

  const transaction = editor.state.tr.replaceWith(diff.from, diff.to, diff.replacement);
  transaction.setMeta("ghost-block-diff", true);
  if (options.addToHistory === false) transaction.setMeta("addToHistory", false);
  editor.view.dispatch(transaction);
  return "applied";
}
