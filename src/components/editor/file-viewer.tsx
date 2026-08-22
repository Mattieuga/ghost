import { MarkdownEditor } from "@/components/editor/markdown-editor";
import { CodeEditor } from "@/components/editor/code-editor";
import { ImageViewer } from "@/components/viewer/image-viewer";
import { PdfViewer } from "@/components/viewer/pdf-viewer";
import { FontViewer } from "@/components/viewer/font-viewer";
import { CsvViewer } from "@/components/viewer/csv-viewer";
import { SvgViewer } from "@/components/viewer/svg-viewer";
import { UnsupportedViewer } from "@/components/viewer/unsupported-viewer";
import { AudioViewer } from "@/components/viewer/audio-viewer";
import { requiresMarkdownSourceMode, type FileDescriptor } from "@/lib/file-type";
import type { Editor } from "@tiptap/react";
import type { EditorView } from "@codemirror/view";

interface FileViewerProps {
  filePath: string;
  content: string;
  onContentChange: (text: string) => void | Promise<void>;
  searchTerm: string;
  replaceTerm: string;
  onSearchResults: (count: number, currentIndex: number) => void;
  onTiptapReady?: (editor: Editor | null) => void;
  onCmReady?: (view: EditorView | null) => void;
  showStyleBar?: boolean;
  onToggleStyleBar?: () => void;
  descriptor: FileDescriptor;
}

function assertNever(kind: never): never {
  throw new Error(`Unhandled viewer kind: ${kind}`);
}

export function FileViewer({
  filePath,
  content,
  onContentChange,
  searchTerm,
  replaceTerm,
  onSearchResults,
  onTiptapReady,
  onCmReady,
  showStyleBar,
  onToggleStyleBar,
  descriptor,
}: FileViewerProps) {
  const kind = descriptor.kind;

  switch (kind) {
    case "markdown":
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
          onContentChange={onContentChange}
          searchTerm={searchTerm}
          replaceTerm={replaceTerm}
          onSearchResults={onSearchResults}
          activeFile={filePath}
          onEditorReady={onCmReady}
        />
      );
    case "code":
      return (
        <CodeEditor
          key={filePath}
          content={content}
          onContentChange={onContentChange}
          searchTerm={searchTerm}
          replaceTerm={replaceTerm}
          onSearchResults={onSearchResults}
          activeFile={filePath}
          onEditorReady={onCmReady}
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
    case "svg":
      return (
        <SvgViewer
          key={filePath}
          filePath={filePath}
          content={content}
          onContentChange={onContentChange}
          searchTerm={searchTerm}
          replaceTerm={replaceTerm}
          onSearchResults={onSearchResults}
          onEditorReady={onCmReady}
        />
      );
    case "csv":
      return (
        <CsvViewer
          key={filePath}
          filePath={filePath}
          content={content}
          onContentChange={onContentChange}
          searchTerm={searchTerm}
          replaceTerm={replaceTerm}
          onSearchResults={onSearchResults}
          onEditorReady={onCmReady}
        />
      );
    case "unsupported":
      return <UnsupportedViewer key={filePath} filePath={filePath} />;
    default:
      return assertNever(kind);
  }
}
