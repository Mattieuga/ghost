import type { EditorView } from "@codemirror/view";

/**
 * WKWebView can reveal CodeMirror's stale DOM selection when an unfocused
 * editor receives a pointer click. This is especially visible after dragging
 * the scrollbar. CodeMirror calculates the pointer position, focuses the old
 * selection, and then calculates the pointer position again. If focus moved
 * the viewport, those positions become an accidental range selection.
 *
 * For an ordinary click, prime the state selection under the pointer before
 * CodeMirror performs its focus handoff. Modified clicks keep CodeMirror's
 * native range/multiple-selection behavior, and keyboard/search focus is
 * untouched.
 */
export function installPointerFocusScrollGuard(view: EditorView): () => void {
  const handleMouseDown = (event: MouseEvent) => {
    if (
      event.button !== 0
      || view.hasFocus
      || event.shiftKey
      || event.metaKey
      || event.ctrlKey
      || event.altKey
    ) return;

    const position = view.posAtCoords({ x: event.clientX, y: event.clientY }, false);
    if (position === null) return;

    const selection = view.state.selection.main;
    if (selection.empty && selection.head === position) return;
    view.dispatch({
      selection: { anchor: position },
      userEvent: "select.pointer",
    });
  };

  view.contentDOM.addEventListener("mousedown", handleMouseDown, true);
  return () => {
    view.contentDOM.removeEventListener("mousedown", handleMouseDown, true);
  };
}
