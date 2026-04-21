import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

interface UseReloadOnFocusParams {
  /** Returns the current file path. Return null to skip the reload. */
  getPath: () => string | null;
  /**
   * Apply new content to the editor in place. Called after we verify the disk
   * content differs from what we last wrote. The implementation is editor-
   * specific (Tiptap vs CodeMirror) and lives in the caller.
   *
   * Return `true` if the content was applied, `false` to skip (e.g. the editor
   * was destroyed or the user typed during the await).
   */
  applyContent: React.RefObject<((content: string) => boolean) | null>;
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
  applyContent,
  contentRef,
  lastSaveTimestamp,
  onContentApplied,
}: UseReloadOnFocusParams) {
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

      inFlight.current = true;
      try {
        const content = await invoke<string>("read_file", { path });

        // Race guard — user may have navigated away during await.
        if (getPathRef.current() !== path) return;

        // Short-circuit if disk matches what we last wrote. No external change.
        if (content === contentRef.current) return;

        // Delegate to the editor-specific apply callback.
        const applied = applyContent.current?.(content);
        if (!applied) return;

        contentRef.current = content;
        onContentAppliedRef.current?.(content);
      } catch (err) {
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
  }, [applyContent, contentRef, lastSaveTimestamp]);
}
