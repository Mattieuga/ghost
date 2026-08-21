import type { Editor } from "@tiptap/react";
import type { EditorView } from "@codemirror/view";
import { TextSelection } from "@tiptap/pm/state";
import { parseMarkdownDocument } from "../components/editor/frontmatter";
import {
  isMarkdownDocumentDirty,
  resetMarkdownDocumentState,
} from "../components/editor/markdown-source";

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function applyContentInPlace(
  editorRef: React.RefObject<Editor | null>,
  cmViewRef: React.RefObject<EditorView | null>,
  scrollElRef: React.RefObject<HTMLElement | null>,
  content: string,
): boolean {
  const scrollEl = scrollElRef.current;
  const scrollTop = scrollEl?.scrollTop ?? 0;

  const editor = editorRef.current;
  if (editor && !editor.isDestroyed) {
    // Never replace a local edit that is still waiting for its checked write.
    // The eventual save will surface an external-change conflict instead.
    if (isMarkdownDocumentDirty(editor)) return false;

    const { from, to } = editor.state.selection;
    editor
      .chain()
      .setContent(parseMarkdownDocument(editor, content), { emitUpdate: false })
      .command(({ tr, dispatch }) => {
        if (!dispatch) return true;
        const docSize = tr.doc.content.size;
        try {
          const $from = tr.doc.resolve(Math.min(from, docSize));
          const $to = tr.doc.resolve(Math.min(to, docSize));
          tr.setSelection(TextSelection.between($from, $to));
        } catch {
          // New doc has no valid text position near the old offset.
        }
        return true;
      })
      .run();
    resetMarkdownDocumentState(editor);
    if (scrollEl) scrollEl.scrollTop = scrollTop;
    return true;
  }

  const view = cmViewRef.current;
  if (view) {
    const cursor = view.state.selection.main.head;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: content },
      selection: { anchor: Math.min(cursor, content.length) },
    });
    if (scrollEl) scrollEl.scrollTop = scrollTop;
    return true;
  }

  return false;
}
