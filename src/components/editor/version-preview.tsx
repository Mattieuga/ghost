import type { JSONContent } from "@tiptap/core";
import { diffMarkExtensions } from "@/components/editor/diff-marks";
import { MarkdownEditor, type MarkdownEditorPlatformActions } from "@/components/editor/markdown-editor";

/**
 * A version shown in the editor's own surface, read-only, with what it
 * changed marked. Keyed by the version so a new selection is a new editor.
 */
export function VersionPreview({
  versionId,
  document,
  platformActions,
}: {
  versionId: string;
  document: JSONContent;
  platformActions?: MarkdownEditorPlatformActions;
}) {
  return (
    <div data-version-preview className="h-full">
      <MarkdownEditor
        key={versionId}
        initialDocument={document}
        extraExtensions={diffMarkExtensions}
        editable={false}
        showStyleBar={false}
        platformActions={platformActions}
      />
    </div>
  );
}
