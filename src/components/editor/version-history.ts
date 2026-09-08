import type { Editor, JSONContent } from "@tiptap/core";
import type { CloudCollaborationSession } from "@/cloud/collaboration/types";
import type { CloudDocumentVersion, CloudDocumentVersionReason } from "@/cloud/cloud-version-history";
import { parseMarkdownDocument } from "@/components/editor/frontmatter";
import type { HistoryVersion } from "@/components/editor/version-history-sidebar";
import { applyDocumentAsBlockDiff } from "@/lib/mirror/block-diff";
import type { LocalVersionFile, LocalVersionReason } from "@/lib/mirror/local-versions";
import { diffMarkdownVersions } from "@/lib/version-diff";

/** The shape both hosts feed the history sidebar, and how a version comes back. */

export function cloudToHistory(version: CloudDocumentVersion): HistoryVersion {
  return {
    id: `cloud:${version.id}`,
    createdAt: version.created_at,
    reason: version.reason,
    source: "cloud",
    markdown: version.markdown_snapshot,
  };
}

export function localToHistory(file: LocalVersionFile, markdown: string): HistoryVersion {
  return {
    id: `local:${file.name}`,
    createdAt: file.createdAt,
    reason: file.reason,
    source: "local",
    markdown,
  };
}

/**
 * What the selected version changed, against the version just before it.
 * The oldest version has nothing to compare with and is shown as is.
 */
export function previewFor(versions: HistoryVersion[], selectedId: string | null): JSONContent | null {
  const index = versions.findIndex((version) => version.id === selectedId);
  if (index < 0) return null;
  const previous = versions[index + 1]?.markdown ?? null;
  return diffMarkdownVersions(previous, versions[index].markdown);
}

export interface RestoreDeps {
  editor: Editor;
  session: CloudCollaborationSession | null;
  /** Cloud history, when the note has a Cloud session. */
  captureCloud?: (reason: CloudDocumentVersionReason, restoredFromVersionId?: number | null) => Promise<unknown>;
  cancelScheduledCloud?: () => void;
  /** Local history on the Mac. */
  captureLocal?: (reason: LocalVersionReason) => Promise<void>;
}

/**
 * Make a version the current text. A backup version is saved first, the
 * document is changed as a block diff so collaborators keep their cursors,
 * and the result is saved as a version of its own.
 */
export async function restoreVersion(deps: RestoreDeps, version: HistoryVersion): Promise<void> {
  deps.cancelScheduledCloud?.();
  await deps.captureLocal?.("restore_backup");
  await deps.captureCloud?.("restore_backup");
  // The shared parser keeps frontmatter and table widths, which Tiptap's
  // raw Markdown content type drops.
  applyDocumentAsBlockDiff(deps.editor, parseMarkdownDocument(deps.editor, version.markdown));
  await deps.session?.flush();
  const restoredFrom = version.source === "cloud" ? Number(version.id.slice("cloud:".length)) : null;
  await deps.captureLocal?.("restore");
  await deps.captureCloud?.("restore", Number.isFinite(restoredFrom) ? restoredFrom : null);
}
