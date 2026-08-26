import { MarkdownEditor } from "@/components/editor/markdown-editor";
import { CodeEditor } from "@/components/editor/code-editor";
import { ImageViewer } from "@/components/viewer/image-viewer";
import { PdfViewer } from "@/components/viewer/pdf-viewer";
import { FontViewer } from "@/components/viewer/font-viewer";
import { CsvViewer } from "@/components/viewer/csv-viewer";
import { SvgViewer } from "@/components/viewer/svg-viewer";
import { HtmlViewer } from "@/components/viewer/html-viewer";
import { UnsupportedViewer } from "@/components/viewer/unsupported-viewer";
import { AudioViewer } from "@/components/viewer/audio-viewer";
import { VideoViewer } from "@/components/viewer/video-viewer";
import { ArchiveViewer } from "@/components/viewer/archive-viewer";
import { QuickLookViewer } from "@/components/viewer/quick-look-viewer";
import { requiresMarkdownSourceMode, type FileDescriptor } from "@/lib/file-type";
import type { Editor } from "@tiptap/react";
import type { EditorView } from "@codemirror/view";
import type { SourceDocumentSnapshot } from "@/lib/source-document";
import type { Text } from "@codemirror/state";
import {
  formatSourceSize,
  type SourceInspection,
  type SourceProfile,
} from "@/lib/resource-policy";
import { LargeTextViewer } from "@/components/viewer/large-text-viewer";
import type { FileOpenPerformanceTrace } from "@/lib/open-performance";

interface FileViewerProps {
  filePath: string;
  content: string;
  onContentChange: (text: string) => void | Promise<void>;
  onSourceChange: (snapshot: SourceDocumentSnapshot) => Promise<void>;
  searchTerm: string;
  replaceTerm: string;
  onSearchResults: (count: number, currentIndex: number) => void;
  onTiptapReady?: (editor: Editor | null) => void;
  onCmReady?: (view: EditorView | null) => void;
  showStyleBar?: boolean;
  onToggleStyleBar?: () => void;
  descriptor: FileDescriptor;
  sourceDocument?: Text | null;
  sourceProfile?: SourceProfile | null;
  sourceInspection?: SourceInspection | null;
  lineSeparator?: string;
  onSourceDirtyChange?: (dirty: boolean) => void;
  openPerformance?: FileOpenPerformanceTrace | null;
}

function assertNever(kind: never): never {
  throw new Error(`Unhandled viewer kind: ${kind}`);
}

export function FileViewer({
  filePath,
  content,
  onContentChange,
  onSourceChange,
  searchTerm,
  replaceTerm,
  onSearchResults,
  onTiptapReady,
  onCmReady,
  showStyleBar,
  onToggleStyleBar,
  descriptor,
  sourceDocument,
  sourceProfile,
  sourceInspection,
  lineSeparator,
  onSourceDirtyChange,
  openPerformance,
}: FileViewerProps) {
  const kind = descriptor.kind;

  if (sourceProfile === "extreme" && sourceInspection) {
    return (
      <LargeTextViewer
        key={filePath}
        filePath={filePath}
        inspection={sourceInspection}
        openPerformance={openPerformance}
      />
    );
  }

  const sourceEditor = sourceProfile === "large" && sourceDocument ? (
    <div className="flex h-full flex-col pt-12">
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border bg-muted/35 px-4 py-2 text-[11px] text-muted-foreground">
        <span>Large-file mode · language features and wrapping are disabled</span>
        {sourceInspection && <span>{formatSourceSize(sourceInspection.size_bytes)}</span>}
      </div>
      <div className="min-h-0 flex-1">
        <CodeEditor
          key={`${filePath}:${sourceInspection?.version.size_bytes ?? 0}:${sourceInspection?.version.modified_ns ?? "large"}:${sourceInspection?.version.file_id ?? ""}`}
          content={sourceDocument}
          onContentChange={onSourceChange}
          searchTerm={searchTerm}
          replaceTerm={replaceTerm}
          onSearchResults={onSearchResults}
          activeFile={filePath}
          onEditorReady={onCmReady}
          sourceProfile="large"
          lineSeparator={lineSeparator}
          onDirtyChange={onSourceDirtyChange}
          openPerformance={openPerformance}
        />
      </div>
    </div>
  ) : null;

  switch (kind) {
    case "markdown":
      if (sourceEditor) return sourceEditor;
      if (!requiresMarkdownSourceMode(filePath, content)) {
        return (
          <MarkdownEditor
            key={filePath}
            content={content}
            onContentChange={onContentChange}
            searchTerm={searchTerm}
            replaceTerm={replaceTerm}
            onSearchResults={onSearchResults}
            activeFile={filePath}
            showStyleBar={showStyleBar}
            onToggleStyleBar={onToggleStyleBar}
            onEditorReady={onTiptapReady}
          />
        );
      }
      return (
        <CodeEditor
          key={filePath}
          content={content}
          onContentChange={onSourceChange}
          searchTerm={searchTerm}
          replaceTerm={replaceTerm}
          onSearchResults={onSearchResults}
          activeFile={filePath}
          onEditorReady={onCmReady}
          onDirtyChange={onSourceDirtyChange}
          openPerformance={openPerformance}
        />
      );
    case "code":
      if (sourceEditor) return sourceEditor;
      return (
        <CodeEditor
          key={filePath}
          content={content}
          onContentChange={onSourceChange}
          searchTerm={searchTerm}
          replaceTerm={replaceTerm}
          onSearchResults={onSearchResults}
          activeFile={filePath}
          onEditorReady={onCmReady}
          onDirtyChange={onSourceDirtyChange}
          openPerformance={openPerformance}
        />
      );
    case "image":
      return <ImageViewer key={filePath} filePath={filePath} />;
    case "pdf":
      return <PdfViewer key={filePath} filePath={filePath} />;
    case "font":
      return <FontViewer key={filePath} filePath={filePath} />;
    case "audio":
      return <AudioViewer key={filePath} filePath={filePath} />;
    case "video":
      return <VideoViewer key={filePath} filePath={filePath} />;
    case "archive":
      return <ArchiveViewer key={filePath} filePath={filePath} />;
    case "quick-look":
      return <QuickLookViewer key={filePath} filePath={filePath} />;
    case "svg":
      if (sourceEditor) return sourceEditor;
      return (
        <SvgViewer
          key={filePath}
          filePath={filePath}
          content={content}
          onSourceChange={onSourceChange}
          searchTerm={searchTerm}
          replaceTerm={replaceTerm}
          onSearchResults={onSearchResults}
          onEditorReady={onCmReady}
          onDirtyChange={onSourceDirtyChange}
          lineSeparator={lineSeparator}
        />
      );
    case "html":
      if (sourceEditor) return sourceEditor;
      return (
        <HtmlViewer
          key={filePath}
          filePath={filePath}
          content={content}
          onSourceChange={onSourceChange}
          searchTerm={searchTerm}
          replaceTerm={replaceTerm}
          onSearchResults={onSearchResults}
          onEditorReady={onCmReady}
          onDirtyChange={onSourceDirtyChange}
          lineSeparator={lineSeparator}
        />
      );
    case "csv":
      if (sourceEditor) return sourceEditor;
      return (
        <CsvViewer
          key={filePath}
          filePath={filePath}
          content={content}
          onContentChange={onContentChange}
          onSourceChange={onSourceChange}
          searchTerm={searchTerm}
          replaceTerm={replaceTerm}
          onSearchResults={onSearchResults}
          onEditorReady={onCmReady}
          onDirtyChange={onSourceDirtyChange}
          lineSeparator={lineSeparator}
        />
      );
    case "unsupported":
      return <UnsupportedViewer key={filePath} filePath={filePath} />;
    default:
      return assertNever(kind);
  }
}
