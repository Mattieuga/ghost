import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { CodeEditor } from "@/components/editor/code-editor";
import type { EditorView } from "@codemirror/view";
import type { SourceDocumentSnapshot } from "@/lib/source-document";

interface SvgViewerProps {
  filePath: string;
  content: string;
  onSourceChange: (snapshot: SourceDocumentSnapshot) => Promise<void>;
  searchTerm?: string;
  replaceTerm?: string;
  onSearchResults?: (count: number, currentIndex: number) => void;
  onEditorReady?: (view: EditorView | null) => void;
  onDirtyChange?: (dirty: boolean) => void;
  lineSeparator?: string;
}

function svgToDataUrl(svgText: string): string {
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgText)))}`;
}

export function SvgViewer({
  filePath,
  content,
  onSourceChange,
  searchTerm,
  replaceTerm,
  onSearchResults,
  onEditorReady,
  onDirtyChange,
  lineSeparator,
}: SvgViewerProps) {
  const [preview, setPreview] = useState(content);
  const updateTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dataUrl = useMemo(() => svgToDataUrl(preview), [preview]);

  useEffect(() => {
    return () => { if (updateTimeout.current) clearTimeout(updateTimeout.current); };
  }, []);

  const handleContentChange = useCallback((snapshot: SourceDocumentSnapshot) => {
    const text = snapshot.document.toString();
    if (updateTimeout.current) clearTimeout(updateTimeout.current);
    updateTimeout.current = setTimeout(() => setPreview(text), 300);
    return onSourceChange(snapshot);
  }, [onSourceChange]);

  return (
    <div className="flex flex-col h-full">
      {/* SVG Preview with checkerboard background */}
      <div
        className="shrink-0 flex items-center justify-center p-6 pt-16 border-b border-border max-h-[40vh] overflow-auto"
        style={{
          backgroundImage: "linear-gradient(45deg, var(--muted) 25%, transparent 25%), linear-gradient(-45deg, var(--muted) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--muted) 75%), linear-gradient(-45deg, transparent 75%, var(--muted) 75%)",
          backgroundSize: "20px 20px",
          backgroundPosition: "0 0, 0 10px, 10px -10px, -10px 0",
        }}
      >
        <img
          src={dataUrl}
          alt={filePath.split("/").pop() ?? "SVG"}
          className="max-w-full max-h-[30vh] w-auto h-auto"
        />
      </div>

      {/* Code Editor */}
      <div className="flex-1 min-h-0">
        <CodeEditor
          content={content}
          onContentChange={handleContentChange}
          activeFile={filePath}
          searchTerm={searchTerm}
          replaceTerm={replaceTerm}
          onSearchResults={onSearchResults}
          onEditorReady={onEditorReady}
          onDirtyChange={onDirtyChange}
          lineSeparator={lineSeparator}
        />
      </div>
    </div>
  );
}
