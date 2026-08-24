import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { EditorState, StateEffect } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  lineNumbers,
} from "@codemirror/view";
import { FileQuestion, Loader2 } from "lucide-react";
import { AudioViewer } from "@/components/viewer/audio-viewer";
import { FontViewer } from "@/components/viewer/font-viewer";
import { ImageViewer } from "@/components/viewer/image-viewer";
import { PdfViewer } from "@/components/viewer/pdf-viewer";
import { VideoViewer } from "@/components/viewer/video-viewer";
import { ghostTheme } from "@/components/editor/codemirror-theme";
import { classifyFile, getLanguageSupport } from "@/lib/file-type";

export interface ArchivePreviewArtifact {
  token: string;
  path: string;
  display_name: string;
  mime_type: string | null;
  size_bytes: number;
}

function ReadOnlySourcePreview({ artifact }: { artifact: ArchivePreviewArtifact }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setContent(null);
    setError(null);
    void invoke<string>("read_file", { path: artifact.path }).then((text) => {
      if (!cancelled) setContent(text);
    }).catch((reason) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => { cancelled = true; };
  }, [artifact.path]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || content === null) return;
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: content,
        extensions: [
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          lineNumbers(),
          highlightActiveLine(),
          drawSelection(),
          EditorView.lineWrapping,
          ...ghostTheme,
        ],
      }),
    });
    void getLanguageSupport(artifact.display_name).then((language) => {
      if (language && view.dom.isConnected) {
        view.dispatch({ effects: StateEffect.appendConfig.of(language) });
      }
    });
    return () => view.destroy();
  }, [artifact.display_name, content]);

  if (error) {
    return <div className="flex h-full items-center justify-center p-6 text-sm text-destructive">{error}</div>;
  }
  if (content === null) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Loading preview…
      </div>
    );
  }
  return <div ref={hostRef} data-viewer-focus-target className="h-full min-h-0 overflow-hidden" />;
}

export function ArchiveEntryPreview({ artifact }: { artifact: ArchivePreviewArtifact }) {
  const descriptor = useMemo(() => classifyFile(artifact.path), [artifact.path]);

  switch (descriptor.kind) {
    case "markdown":
    case "code":
    case "csv":
      return <ReadOnlySourcePreview artifact={artifact} />;
    case "svg":
    case "image":
      return <ImageViewer filePath={artifact.path} displayName={artifact.display_name} />;
    case "pdf":
      return <PdfViewer filePath={artifact.path} />;
    case "font":
      return <FontViewer filePath={artifact.path} displayName={artifact.display_name} />;
    case "audio":
      return <AudioViewer filePath={artifact.path} displayName={artifact.display_name} />;
    case "video":
      return <VideoViewer filePath={artifact.path} displayName={artifact.display_name} />;
    case "archive":
    case "unsupported":
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
          <FileQuestion className="size-12 text-ring" strokeWidth={1.25} aria-hidden="true" />
          <div className="text-sm font-medium text-foreground">No in-app preview for this entry</div>
          <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
            {artifact.mime_type ?? "Ghost could not identify the decompressed file type."}
          </p>
        </div>
      );
    default:
      return null;
  }
}
