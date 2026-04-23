import { MarkdownEditor } from "@/components/editor/markdown-editor";
import { CodeEditor } from "@/components/editor/code-editor";
import { ImageViewer } from "@/components/viewer/image-viewer";
import { PdfViewer } from "@/components/viewer/pdf-viewer";
import { CsvViewer } from "@/components/viewer/csv-viewer";
import { SvgViewer } from "@/components/viewer/svg-viewer";
import { UnsupportedViewer } from "@/components/viewer/unsupported-viewer";
import { isMarkdown, isImage, isPdf, isCsv, isSvg, isTextEditable } from "@/lib/file-type";
import type { Editor } from "@tiptap/react";
import type { EditorView } from "@codemirror/view";

interface FileViewerProps {
  filePath: string;
  content: string;
  onContentChange: (text: string) => void;
  searchTerm: string;
  replaceTerm: string;
  onSearchResults: (count: number, currentIndex: number) => void;
  onTiptapReady?: (editor: Editor | null) => void;
  onCmReady?: (view: EditorView | null) => void;
  showStyleBar?: boolean;
  onToggleStyleBar?: () => void;
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
}: FileViewerProps) {
  if (isMarkdown(filePath)) {
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

  if (isImage(filePath)) return <ImageViewer key={filePath} filePath={filePath} />;
  if (isPdf(filePath)) return <PdfViewer key={filePath} filePath={filePath} />;

  if (isSvg(filePath)) {
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
  }

  if (isCsv(filePath)) {
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
  }

  if (!isTextEditable(filePath)) return <UnsupportedViewer key={filePath} filePath={filePath} />;

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
}
