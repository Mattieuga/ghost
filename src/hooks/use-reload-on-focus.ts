import { useEffect, useRef } from "react";
import type { LocalDocumentRef } from "@/lib/document-ref";
import {
  tauriLocalDocumentSource,
  type LocalDocumentSource,
} from "@/lib/local-document-source";
import type { FileVersionToken } from "@/lib/source-document";

interface UseReloadOnFocusParams {
  /** Returns the current local document. Return null to skip the reload. */
  getDocument: () => LocalDocumentRef | null;
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
  /** Compact native identity used when no complete source string is retained. */
  versionRef?: React.RefObject<FileVersionToken | null>;
  /** Ref tracking the timestamp of the last successful save from handleContentChange. */
  lastSaveTimestamp: React.RefObject<number>;
  /** Number of queued or in-flight saves. External reloads wait until it is zero. */
  pendingSaveCount?: React.RefObject<number>;
  /** A failed local write must never be replaced by a later disk reload. */
  hasFailedSave?: React.RefObject<boolean>;
  /** Called after content is applied in place. Receives the new content. */
  onContentApplied?: (content: string) => void;
  /** Metadata-first model reload for profiled source documents. */
  onVersionChanged?: (ref: LocalDocumentRef, version: FileVersionToken) => Promise<boolean>;
  source?: LocalDocumentSource;
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
  getDocument,
  applyContent,
  contentRef,
  versionRef,
  lastSaveTimestamp,
  pendingSaveCount,
  hasFailedSave,
  onContentApplied,
  onVersionChanged,
  source = tauriLocalDocumentSource,
}: UseReloadOnFocusParams) {
  const getDocumentRef = useRef(getDocument);
  getDocumentRef.current = getDocument;
  const onContentAppliedRef = useRef(onContentApplied);
  onContentAppliedRef.current = onContentApplied;
  const onVersionChangedRef = useRef(onVersionChanged);
  onVersionChangedRef.current = onVersionChanged;

  // Serializes handler invocations — rapid focus cycles would otherwise queue
  // concurrent reads and double-dispatch transactions that collapse selection.
  const inFlight = useRef(false);

  useEffect(() => {
    const handleFocus = async () => {
      if (inFlight.current) return;

      const documentRef = getDocumentRef.current();
      if (!documentRef) return;
      if ((pendingSaveCount?.current ?? 0) > 0) return;
      if (hasFailedSave?.current) return;

      // Skip if we just saved (avoid reloading our own writes).
      if (Date.now() - lastSaveTimestamp.current < 1000) return;

      inFlight.current = true;
      try {
        const version = await source.getVersion(documentRef);

        // Large source saves intentionally do not retain a flattened string.
        // Metadata equality keeps focus reload from recreating one merely to
        // compare it with disk.
        if (
          versionRef?.current
          && JSON.stringify(version) === JSON.stringify(versionRef.current)
        ) return;

        if (await onVersionChangedRef.current?.(documentRef, version)) return;

        const content = await source.readText(documentRef);

        // Race guard — user may have navigated away during await.
        if (getDocumentRef.current()?.path !== documentRef.path) return;

        // Short-circuit if disk matches what we last wrote. No external change.
        if (content === contentRef.current) return;

        // Delegate to the editor-specific apply callback.
        const applied = applyContent.current?.(content);
        if (!applied) return;

        contentRef.current = content;
        if (versionRef) versionRef.current = version;
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
  }, [
    applyContent,
    contentRef,
    hasFailedSave,
    lastSaveTimestamp,
    pendingSaveCount,
    source,
    versionRef,
  ]);
}
