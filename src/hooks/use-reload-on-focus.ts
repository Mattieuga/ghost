import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { TextSelection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";

interface UseReloadOnFocusParams {
  /** Returns the current file path. Return null to skip the reload. */
  getPath: () => string | null;
  /** Ref holding the current editor instance. */
  editorRef: React.RefObject<Editor | null>;
  /** Ref holding the scroll container element whose scrollTop should be preserved. */
  scrollElRef: React.RefObject<HTMLElement | null>;
  /** Ref tracking last-known-on-disk content. Updated after a successful apply. */
  contentRef: React.RefObject<string | null>;
  /** Ref tracking the timestamp of the last successful save from handleContentChange. */
  lastSaveTimestamp: React.RefObject<number>;
  /** Called after content is applied in place. Receives the new content. */
  onContentApplied?: (content: string) => void;
}

/**
 * On window focus, reload the active file from disk and apply any external
 * changes in place — without remounting the editor and without losing the
 * user's scroll or cursor. Safe across a number of races (see comments).
 *
 * This hook is consumed by both the main window (GhostLayout) and the
 * accessory window (EditorWindow), which otherwise held near-identical copies
 * of the focus handler. Keep the race-handling logic in here so bug fixes
 * land once.
 */
export function useReloadOnFocus({
  getPath,
  editorRef,
  scrollElRef,
  contentRef,
  lastSaveTimestamp,
  onContentApplied,
}: UseReloadOnFocusParams) {
  // Mirror non-ref params into refs so the window listener can stay subscribed
  // for the lifetime of the component — no re-subscribes on parent re-renders.
  const getPathRef = useRef(getPath);
  getPathRef.current = getPath;
  const onContentAppliedRef = useRef(onContentApplied);
  onContentAppliedRef.current = onContentApplied;

  // Serializes handler invocations — rapid focus cycles would otherwise queue
  // concurrent reads and double-dispatch transactions that collapse selection.
  const inFlight = useRef(false);

  useEffect(() => {
    const handleFocus = async () => {
      if (inFlight.current) return;

      const path = getPathRef.current();
      if (!path) return;

      // Skip if we just saved (avoid reloading our own writes).
      if (Date.now() - lastSaveTimestamp.current < 1000) return;

      // Snapshot identity BEFORE the await — used to detect races after resume.
      const editorBefore = editorRef.current;
      if (!editorBefore || editorBefore.isDestroyed) return;
      const docBefore = editorBefore.state.doc;

      inFlight.current = true;
      try {
        const content = await invoke<string>("read_file", { path });

        // Race guards — verify the world we resumed into matches the world we
        // snapshotted before the await. Bail on any mismatch.
        if (getPathRef.current() !== path) return;           // user navigated away
        const editor = editorRef.current;
        if (!editor || editor.isDestroyed) return;           // editor unmounted
        if (editor !== editorBefore) return;                 // editor replaced
        if (editor.state.doc !== docBefore) return;          // user typed during await

        // Short-circuit if disk matches what we last wrote. No external change.
        if (content === contentRef.current) return;

        // Snapshot cursor and scroll before mutating the doc.
        const scrollEl = scrollElRef.current;
        const scrollTop = scrollEl?.scrollTop ?? 0;
        const { from, to } = editor.state.selection;

        // Apply the external change in place and restore selection in the
        // same transaction via a chained command. Using `chain()` keeps it
        // to one history entry, and the inline command lets us compute the
        // clamped selection against the NEW doc (tr.doc reflects the post-
        // setContent state).
        //
        // emitUpdate=false prevents our onUpdate/debouncedSave from firing
        // and writing the externally-loaded content right back to disk.
        editor
          .chain()
          .setContent(content, false)
          .command(({ tr, dispatch }) => {
            if (!dispatch) return true;
            const docSize = tr.doc.content.size;
            try {
              // TextSelection.between snaps to the nearest valid text
              // position, so a clamped number that lands inside a non-text
              // node (image, table boundary) will not throw.
              const $from = tr.doc.resolve(Math.min(from, docSize));
              const $to = tr.doc.resolve(Math.min(to, docSize));
              tr.setSelection(TextSelection.between($from, $to));
            } catch {
              // New doc has no valid text position near the old offset.
              // Leave the default selection that setContent produced.
            }
            return true;
          })
          .run();

        // Restore scroll last so any incidental scroll from the transaction
        // is overridden. Belt-and-suspenders over ProseMirror's own resetScrollPos.
        if (scrollEl) scrollEl.scrollTop = scrollTop;

        contentRef.current = content;
        onContentAppliedRef.current?.(content);
      } catch (err) {
        // File-not-found is expected (file was deleted while away) and stays
        // silent to match the codebase's speculative-read convention. Anything
        // else is a real bug (setContent throw, IPC error, permission) and
        // should surface in devtools so we don't lose observability.
        const message = err instanceof Error ? err.message : String(err);
        if (!/no such file|not found|cannot find/i.test(message)) {
          console.warn("Focus reload failed:", err);
        }
      } finally {
        inFlight.current = false;
      }
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [editorRef, scrollElRef, contentRef, lastSaveTimestamp]);
}
