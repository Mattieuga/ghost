import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { HeadingMinimap } from "@/components/editor/heading-minimap";
import { fontFamilyValue } from "@/lib/fonts";
import { FileViewer } from "@/components/editor/file-viewer";
import { TextStats } from "@/components/editor/text-stats";
import { SaveStatus } from "@/components/editor/save-status";
import type { Editor } from "@tiptap/react";
import type { EditorView } from "@codemirror/view";
import { applyContentInPlace } from "@/lib/editor-utils";
import { SearchBar } from "@/components/editor/search-bar";
import { useSettings } from "@/hooks/use-settings";
import { useCloseSearchWhenUnavailable, useSearch } from "@/hooks/use-search";
import { useReloadOnFocus } from "@/hooks/use-reload-on-focus";
import { applyTheme } from "@/lib/theme-engine";
import {
  classifyFile,
  isTextBackedFile,
  resolveProbedText,
  type FileDescriptor,
} from "@/lib/file-type";
import { loadFileModel } from "@/lib/file-loader";
import { OpenExternalButton } from "@/components/viewer/open-external-button";
import { useDocumentSave } from "@/hooks/use-document-save";
import { retargetCompanionAssetReferences, retargetPath } from "@/lib/file-path";
import {
  getPendingMarkdownDocument,
  isMarkdownDocumentDirty,
  markMarkdownDocumentClean,
  serializeMarkdownDocument,
} from "@/components/editor/markdown-source";

interface EditorWindowProps {
  filePath: string;
}

export function EditorWindow({ filePath: initialFilePath }: EditorWindowProps) {
  const { settings, updateSettings } = useSettings();
  const search = useSearch();
  const [filePath, setFilePath] = useState(initialFilePath);
  const filePathRef = useRef(initialFilePath);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileDescriptor, setFileDescriptor] = useState<FileDescriptor | null>(null);
  const fileDescriptorRef = useRef<FileDescriptor | null>(null);
  fileDescriptorRef.current = fileDescriptor;
  const [liveText, setLiveText] = useState("");
  const lastSaveTimestamp = useRef(0);
  const [mainEl, setMainEl] = useState<HTMLElement | null>(null);
  const [editorInstance, setEditorInstance] = useState<Editor | null>(null);
  const [cmView, setCmView] = useState<EditorView | null>(null);
  const styleBarRef = useRef(settings.showStyleBar);
  styleBarRef.current = settings.showStyleBar;
  const fileContentRef = useRef<string | null>(null);
  const editorInstanceRef = useRef<Editor | null>(null);
  editorInstanceRef.current = editorInstance;
  const cmViewRef = useRef<EditorView | null>(null);
  cmViewRef.current = cmView;
  const mainElRef = useRef<HTMLElement | null>(null);
  mainElRef.current = mainEl;
  const closingRef = useRef(false);
  const skipNextPathLoadRef = useRef(false);
  const liveTextRef = useRef("");

  // Apply theme
  useEffect(() => {
    applyTheme(settings.themeColors, settings.theme, settings.syntaxPalette);
  }, [settings.themeColors, settings.theme, settings.syntaxPalette]);

  // Apply font settings
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--editor-text-font", fontFamilyValue(settings.textFont));
    root.style.setProperty("--editor-heading-font", fontFamilyValue(settings.headingFont));
    root.style.setProperty("--editor-code-font", fontFamilyValue(settings.codeFont));
  }, [settings.textFont, settings.headingFont, settings.codeFont]);

  // Renaming the open file can switch this window to a non-searchable viewer.
  useCloseSearchWhenUnavailable(fileDescriptor?.searchable, search.closeSearch);

  // Load file content on mount
  useEffect(() => {
    if (skipNextPathLoadRef.current) {
      skipNextPathLoadRef.current = false;
      return;
    }
    let cancelled = false;

    const loadFile = async () => {
      try {
        const model = await loadFileModel(filePath);
        if (cancelled) return;
        setFileDescriptor(model.descriptor);
        setFileContent(model.content);
        fileContentRef.current = model.content;
        setLiveText(model.content);
        liveTextRef.current = model.content;
      } catch (err) {
        if (!cancelled) console.error("Failed to read file:", err);
      }
    };

    loadFile();
    return () => { cancelled = true; };
  }, [filePath]);

  // Listen for file deletion — auto-close this window
  useEffect(() => {
    const unlisten = listen<string>("file-deleted", (event) => {
      const currentPath = filePathRef.current;
      if (currentPath === event.payload || currentPath.startsWith(event.payload + "/")) {
        closingRef.current = true;
        void invoke("close_editor_window").catch((error) => {
          closingRef.current = false;
          console.error("Failed to close deleted file window:", error);
        });
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  const applyContentRef = useRef<((content: string) => boolean) | null>(null);
  applyContentRef.current = (content) =>
    applyContentInPlace(editorInstanceRef, cmViewRef, mainElRef, content);

  const documentSave = useDocumentSave({
    knownDiskContent: fileContentRef,
    lastSaveTimestamp,
  });

  // Retarget detached editors after a file or containing folder rename. Read
  // the renamed disk snapshot before saving so Ghost's companion .assets
  // rewrite is treated as part of the rename, not an external conflict.
  useEffect(() => {
    const unlisten = listen<{ oldPath: string; newPath: string }>("file-renamed", async (event) => {
      const { oldPath, newPath } = event.payload;
      const currentPath = filePathRef.current;
      const renamedPath = retargetPath(currentPath, oldPath, newPath);
      if (!renamedPath) return;

      const previousDescriptor = fileDescriptorRef.current;
      const knownBefore = fileContentRef.current ?? "";
      const tiptapEditor = editorInstanceRef.current;
      const isDirectFileRename = currentPath === oldPath;
      const renamedKnown = isDirectFileRename
        ? retargetCompanionAssetReferences(knownBefore, oldPath, newPath)
        : knownBefore;

      filePathRef.current = renamedPath;
      let diskContent = renamedKnown;
      let descriptor = classifyFile(renamedPath);
      try {
        const model = await loadFileModel(renamedPath);
        diskContent = model.content;
        descriptor = model.descriptor;
      } catch (error) {
        console.error("Failed to refresh renamed document:", error);
        if (isTextBackedFile(previousDescriptor) && descriptor.loadMode === "probe-text") {
          descriptor = resolveProbedText(descriptor);
        } else if (!descriptor.editable) {
          diskContent = "";
        }
      }

      const currentEditorText = () => {
        if (tiptapEditor && isMarkdownDocumentDirty(tiptapEditor)) {
          const pending = getPendingMarkdownDocument(tiptapEditor);
          return pending.markdown ?? serializeMarkdownDocument(tiptapEditor);
        }
        return tiptapEditor
          ? knownBefore
          : cmViewRef.current?.state.doc.toString() ?? liveTextRef.current;
      };
      const retargetEditorText = (text: string) => isDirectFileRename
        ? retargetCompanionAssetReferences(text, oldPath, newPath)
        : text;
      const editorText = currentEditorText();
      const hadLocalChanges = tiptapEditor
        ? isMarkdownDocumentDirty(tiptapEditor)
        : editorText !== knownBefore;

      let visibleContent = diskContent;
      if (hadLocalChanges) {
        fileContentRef.current = renamedKnown;
        try {
          if (tiptapEditor) {
            // A user can keep typing while the renamed file is being read or
            // written. Drain revisions until the exact current revision is on
            // disk before replacing the path-keyed editor instance.
            while (isMarkdownDocumentDirty(tiptapEditor)) {
              const pending = getPendingMarkdownDocument(tiptapEditor);
              const markdown = pending.markdown ?? serializeMarkdownDocument(tiptapEditor);
              visibleContent = retargetEditorText(markdown);
              await documentSave.save(renamedPath, visibleContent);
              markMarkdownDocumentClean(tiptapEditor, pending.revision);
            }
          } else {
            let sourceText = editorText;
            while (true) {
              visibleContent = retargetEditorText(sourceText);
              await documentSave.save(renamedPath, visibleContent);
              const latestText = cmViewRef.current?.state.doc.toString() ?? sourceText;
              if (latestText === sourceText) break;
              sourceText = latestText;
            }
          }
        } catch (error) {
          // Preserve the newest local snapshot in the replacement editor.
          // documentSave.flush() keeps close/relaunch blocked until Retry or
          // Overwrite succeeds.
          visibleContent = retargetEditorText(currentEditorText());
          console.error("Renamed document needs save recovery:", error);
        }
      } else {
        fileContentRef.current = diskContent;
      }

      liveTextRef.current = visibleContent;
      lastSaveTimestamp.current = Date.now();
      skipNextPathLoadRef.current = true;
      setFileContent(visibleContent);
      setLiveText(visibleContent);
      setFileDescriptor(descriptor);
      setFilePath(renamedPath);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [documentSave.save]);

  // Native close requests are paused in Rust until the current editor has
  // flushed its debounce and the write has actually completed. A failed save
  // intentionally leaves the window open so the retry/overwrite UI remains
  // available instead of discarding the edit.
  useEffect(() => {
    const unlisten = listen("request-editor-close", async () => {
      if (closingRef.current) return;
      closingRef.current = true;

      try {
        await window.__ghostFlushSave?.();
        await documentSave.flush();
        await invoke("close_editor_window");
      } catch (error) {
        closingRef.current = false;
        console.error("Close paused because the document could not be saved:", error);
      }
    });

    return () => { unlisten.then((fn) => fn()); };
  }, [documentSave.flush]);

  // The updater requires an acknowledgement from each accessory window after
  // its actual disk write completes. This avoids relying on an arbitrary
  // delay before relaunching on slow or synced filesystems.
  useEffect(() => {
    const label = getCurrentWindow().label;
    const unlisten = listen<string>("request-save-flush", async (event) => {
      const requestId = event.payload;
      try {
        await window.__ghostFlushSave?.();
        await documentSave.flush();
        await emitTo("main", "save-flush-result", { requestId, label, ok: true });
      } catch (error) {
        await emitTo("main", "save-flush-result", {
          requestId,
          label,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    return () => { unlisten.then((fn) => fn()); };
  }, [documentSave.flush]);

  useReloadOnFocus({
    getPath: () => isTextBackedFile(fileDescriptorRef.current) ? filePathRef.current : null,
    applyContent: applyContentRef,
    contentRef: fileContentRef,
    lastSaveTimestamp,
    pendingSaveCount: documentSave.pendingSaveRef,
    hasFailedSave: documentSave.hasFailedSaveRef,
    onContentApplied: (content) => setLiveText(content),
  });

  const handleContentChange = useCallback(
    (text: string) => {
      liveTextRef.current = text;
      setLiveText(text);
      return documentSave.save(filePathRef.current, text);
    },
    [documentSave.save]
  );

  // Register window globals for Rust menu events
  useEffect(() => {
    window.__ghostFind = () => {
      if (fileDescriptorRef.current?.searchable) search.openSearch("find");
    };
    window.__ghostFindAndReplace = () => {
      if (fileDescriptorRef.current?.searchable) search.openSearch("replace");
    };
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
        if (fileDescriptorRef.current?.searchable) search.openSearch("find");
      } else if (meta && e.altKey && e.key === "f") {
        e.preventDefault();
        if (fileDescriptorRef.current?.searchable) search.openSearch("replace");
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

  const mdFile = fileDescriptor?.kind === "markdown";

  if (fileContent === null || fileDescriptor === null) {
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
        '--editor-block-spacing': `${settings.blockSpacing}rem`,
        '--editor-heading-spacing': `${settings.headingSpacing}rem`,
        '--editor-heading-after-spacing': `${settings.headingAfterSpacing}rem`,
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
            <div className="flex items-center gap-3">
              {fileDescriptor.editable ? (
                <>
                  <SaveStatus
                    status={documentSave.status}
                    error={documentSave.error}
                    onRetry={documentSave.retry}
                  />
                  {fileDescriptor.showTextStats && (
                    <TextStats
                      text={liveText}
                      countMode={settings.countMode}
                      onCountModeChange={(countMode) => updateSettings({ countMode })}
                    />
                  )}
                </>
              ) : fileDescriptor.canOpenExternally ? (
                <OpenExternalButton filePath={filePath} />
              ) : null}
            </div>
          </>
        )}
      </div>

      {/* Editor */}
      <div className="relative flex-1 overflow-hidden">
        <main ref={setMainEl} className="h-full overflow-auto overscroll-contain relative">
          <FileViewer
            filePath={filePath}
            content={fileContent}
            onContentChange={handleContentChange}
            searchTerm={search.searchOpen ? search.debouncedSearchTerm : ""}
            replaceTerm={search.searchOpen ? search.replaceTerm : ""}
            onSearchResults={search.handleSearchResults}
            onTiptapReady={setEditorInstance}
            onCmReady={setCmView}
            showStyleBar={settings.showStyleBar}
            onToggleStyleBar={() => updateSettings({ showStyleBar: !settings.showStyleBar })}
            descriptor={fileDescriptor}
          />
        </main>
        {mdFile && editorInstance && mainEl && (
          <HeadingMinimap editor={editorInstance} scrollContainer={mainEl} />
        )}
      </div>
    </div>
  );
}
