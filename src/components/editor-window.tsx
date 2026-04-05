import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { MarkdownEditor } from "@/components/editor/markdown-editor";
import { SearchBar } from "@/components/editor/search-bar";
import { useSettings } from "@/hooks/use-settings";
import { useSearch } from "@/hooks/use-search";
import { applyTheme } from "@/lib/theme-engine";

interface EditorWindowProps {
  filePath: string;
}

export function EditorWindow({ filePath: initialFilePath }: EditorWindowProps) {
  const { settings, updateSettings } = useSettings();
  const search = useSearch();
  const [filePath, setFilePath] = useState(initialFilePath);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [wordCount, setWordCount] = useState(0);
  const [contentKey, setContentKey] = useState(0);
  const lastSaveTimestamp = useRef(0);
  const styleBarRef = useRef(settings.showStyleBar);
  styleBarRef.current = settings.showStyleBar;
  const fileContentRef = useRef(fileContent);
  fileContentRef.current = fileContent;

  // Apply theme
  useEffect(() => {
    applyTheme(settings.themeColors);
  }, [settings.themeColors]);

  // Apply font settings
  useEffect(() => {
    const root = document.documentElement;
    const sanitize = (s: string) => s.replace(/[";{}\\]/g, "");
    root.style.setProperty("--editor-text-font", `"${sanitize(settings.textFont)}"`);
    root.style.setProperty("--editor-heading-font", `"${sanitize(settings.headingFont)}"`);
    root.style.setProperty("--editor-code-font", `"${sanitize(settings.codeFont)}"`);
  }, [settings.textFont, settings.headingFont, settings.codeFont]);

  // Load file content on mount
  useEffect(() => {
    invoke<string>("read_file", { path: filePath })
      .then((content) => {
        setFileContent(content);
        const words = content.trim().split(/\s+/).filter(Boolean).length;
        setWordCount(words);
      })
      .catch((err) => console.error("Failed to read file:", err));
  }, [filePath]);

  // Listen for file rename events
  useEffect(() => {
    const unlisten = listen<{ oldPath: string; newPath: string }>("file-renamed", (event) => {
      if (event.payload.oldPath === filePath) {
        setFilePath(event.payload.newPath);
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [filePath]);

  // Listen for file deletion — auto-close this window
  useEffect(() => {
    const unlisten = listen<string>("file-deleted", (event) => {
      if (event.payload === filePath) {
        getCurrentWindow().close();
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [filePath]);

  // Reload file when this window regains focus (picks up changes from other windows)
  useEffect(() => {
    const handleFocus = async () => {
      const elapsed = Date.now() - lastSaveTimestamp.current;
      if (elapsed < 1000) return;
      try {
        const content = await invoke<string>("read_file", { path: filePath });
        if (content !== fileContentRef.current) {
          setFileContent(content);
          setContentKey((k) => k + 1);
          const words = content.trim().split(/\s+/).filter(Boolean).length;
          setWordCount(words);
        }
      } catch {
        // File might have been deleted
      }
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [filePath]);

  const handleContentChange = useCallback(
    async (markdown: string) => {
      const words = markdown.trim().split(/\s+/).filter(Boolean).length;
      setWordCount(words);
      lastSaveTimestamp.current = Date.now();
      try {
        await invoke("write_file", { path: filePath, content: markdown });
      } catch (err) {
        console.error("Failed to save file:", err);
      }
    },
    [filePath]
  );

  // Register window globals for Rust menu events
  useEffect(() => {
    window.__ghostFind = () => search.openSearch("find");
    window.__ghostFindAndReplace = () => search.openSearch("replace");
    window.__ghostToggleStyleBar = () => updateSettings({ showStyleBar: !styleBarRef.current });
    return () => {
      delete window.__ghostFind;
      delete window.__ghostFindAndReplace;
      delete window.__ghostToggleStyleBar;
    };
  }, [search.openSearch]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key === "f" && !e.altKey) {
        e.preventDefault();
        search.openSearch("find");
      } else if (meta && e.altKey && e.key === "f") {
        e.preventDefault();
        search.openSearch("replace");
      } else if (e.key === "Escape" && search.searchOpen) {
        search.closeSearch();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [search.openSearch, search.closeSearch, search.searchOpen]);

  // Derive breadcrumb from file path
  const fileName = filePath.split("/").pop() ?? filePath;
  const parentFolder = (() => {
    const parts = filePath.split("/");
    return parts.length >= 2 ? parts[parts.length - 2] : "";
  })();

  if (fileContent === null) {
    return (
      <div className="flex h-svh items-center justify-center bg-background">
        <p className="text-muted-foreground/40 text-sm">Loading...</p>
      </div>
    );
  }

  return (
    <div
      className="flex h-svh flex-col bg-background text-foreground overflow-hidden"
      style={{
        '--editor-font-size': `${settings.fontSize}px`,
        '--editor-line-height': `${settings.lineHeight}`,
        '--editor-max-width': `${settings.editorWidth}px`,
        '--editor-paragraph-spacing': `${settings.paragraphSpacing}rem`,
        '--editor-heading-spacing': `${settings.headingSpacing}rem`,
      } as React.CSSProperties}
    >
      {/* Title bar */}
      <div
        className="absolute top-0 left-0 right-0 z-10 flex h-12 items-center justify-between pl-[100px] pr-8 bg-background/80 backdrop-blur-sm"
        data-tauri-drag-region
      >
        {search.searchOpen ? (
          <div className="flex items-center flex-1 min-w-0 pointer-events-auto">
            <SearchBar
              mode={search.searchMode}
              searchTerm={search.searchTerm}
              replaceTerm={search.replaceTerm}
              onSearchTermChange={search.handleSearchTermChange}
              onReplaceTermChange={search.setReplaceTerm}
              resultCount={search.searchResultCount}
              resultIndex={search.searchResultIndex}
              onNext={() => window.__ghostSearch?.next()}
              onPrevious={() => window.__ghostSearch?.previous()}
              onReplace={() => window.__ghostSearch?.replace()}
              onReplaceAll={() => window.__ghostSearch?.replaceAll()}
              onClose={search.closeSearch}
              onToggleMode={() => search.setSearchMode(m => m === "find" ? "replace" : "find")}
              searchInputRef={search.searchInputRef}
            />
          </div>
        ) : (
          <>
            <div className="flex items-center min-w-0 flex-1 text-[13px] pointer-events-none">
              <div className="flex items-center min-w-0 overflow-hidden">
                {parentFolder && (
                  <>
                    <span className="text-muted-foreground pointer-events-none select-none truncate" style={{ flexShrink: 10 }}>{parentFolder}</span>
                    <span className="text-ring mx-1 pointer-events-none select-none shrink-0">/</span>
                  </>
                )}
                <span className="text-sidebar-primary font-medium truncate">
                  {fileName}
                </span>
              </div>
            </div>
            <span className="text-[12px] text-ring pointer-events-none select-none whitespace-nowrap shrink-0 ml-3">
              {wordCount} words
            </span>
          </>
        )}
      </div>

      {/* Editor */}
      <main className="h-full overflow-auto overscroll-contain">
        <MarkdownEditor
          key={`${filePath}-${contentKey}`}
          content={fileContent}
          onContentChange={handleContentChange}
          searchTerm={search.searchOpen ? search.debouncedSearchTerm : ""}
          replaceTerm={search.searchOpen ? search.replaceTerm : ""}
          onSearchResults={search.handleSearchResults}
          activeFile={filePath}
          showStyleBar={settings.showStyleBar}
          onToggleStyleBar={() => updateSettings({ showStyleBar: !settings.showStyleBar })}
        />
      </main>
    </div>
  );
}
