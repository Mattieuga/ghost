import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { Code2, Eye } from "lucide-react";
import type { EditorView } from "@codemirror/view";
import { CodeEditor } from "@/components/editor/code-editor";
import type { SourceDocumentSnapshot } from "@/lib/source-document";
import { withHtmlPreviewBase } from "@/lib/html-preview";

interface HtmlViewerProps {
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

export function HtmlViewer({
  filePath,
  content,
  onSourceChange,
  searchTerm,
  replaceTerm,
  onSearchResults,
  onEditorReady,
  onDirtyChange,
  lineSeparator,
}: HtmlViewerProps) {
  const [mode, setMode] = useState<"source" | "preview">("source");
  const [previewSource, setPreviewSource] = useState(content);
  const [baseUrl, setBaseUrl] = useState("");
  const viewRef = useRef<EditorView | null>(null);
  const lastContentRef = useRef(content);

  useEffect(() => {
    if (content === lastContentRef.current) return;
    lastContentRef.current = content;
    setPreviewSource(content);
  }, [content]);

  useEffect(() => {
    let cancelled = false;
    setBaseUrl("");
    void invoke<string>("prepare_html_preview", { path: filePath })
      .then((directory) => {
        if (cancelled) return;
        const path = directory.endsWith("/") ? directory : `${directory}/`;
        setBaseUrl(convertFileSrc(path));
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [filePath]);

  useEffect(() => {
    if (searchTerm) setMode("source");
  }, [searchTerm]);

  const handleEditorReady = useCallback((view: EditorView | null) => {
    viewRef.current = view;
    onEditorReady?.(view);
  }, [onEditorReady]);

  const handleSourceChange = useCallback((snapshot: SourceDocumentSnapshot) => {
    setPreviewSource(snapshot.document.toString());
    return onSourceChange(snapshot);
  }, [onSourceChange]);

  const showPreview = useCallback(() => {
    const current = viewRef.current?.state.doc;
    if (current) setPreviewSource(current.toString());
    setMode("preview");
  }, []);

  const previewDocument = useMemo(
    () => withHtmlPreviewBase(previewSource, baseUrl),
    [baseUrl, previewSource],
  );

  const modeToggle = (
    <div className="flex shrink-0 items-center border-t border-border bg-background px-4 py-2.5 text-[11px] text-ring">
      <div className="flex overflow-hidden rounded-md border border-border">
        <button
          onClick={() => setMode("source")}
          className={`flex items-center gap-1.5 px-2 py-1 transition-colors ${
            mode === "source" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-card-foreground"
          }`}
        >
          <Code2 className="size-3.5" /> Source
        </button>
        <button
          onClick={showPreview}
          className={`flex items-center gap-1.5 px-2 py-1 transition-colors ${
            mode === "preview" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-card-foreground"
          }`}
        >
          <Eye className="size-3.5" /> Preview
        </button>
      </div>
      <div className="flex-1" />
      {mode === "preview" && <span>Sandboxed preview · scripts and navigation disabled</span>}
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1">
        {mode === "source" ? (
          <CodeEditor
            content={previewSource}
            onContentChange={handleSourceChange}
            activeFile={filePath}
            searchTerm={searchTerm}
            replaceTerm={replaceTerm}
            onSearchResults={onSearchResults}
            onEditorReady={handleEditorReady}
            onDirtyChange={onDirtyChange}
            lineSeparator={lineSeparator}
          />
        ) : (
          <div className="h-full bg-muted/30 pt-12">
            <iframe
              title={`Preview of ${filePath.split("/").pop() ?? filePath}`}
              srcDoc={previewDocument}
              sandbox=""
              referrerPolicy="no-referrer"
              className="h-full w-full border-0 bg-white"
              data-viewer-focus-target
            />
          </div>
        )}
      </div>
      {modeToggle}
    </div>
  );
}
