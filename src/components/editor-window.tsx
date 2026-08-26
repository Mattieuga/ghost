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
import type { Text as CodeMirrorText } from "@codemirror/state";
import { applyContentInPlace, focusViewerTarget } from "@/lib/editor-utils";
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
import {
  retargetCompanionAssetDocument,
  retargetCompanionAssetReferences,
  retargetPath,
} from "@/lib/file-path";
import {
  getPendingMarkdownDocument,
  isMarkdownDocumentDirty,
  markMarkdownDocumentClean,
  serializeMarkdownDocument,
} from "@/components/editor/markdown-source";
import type { FileVersionToken, SourceDocumentSnapshot } from "@/lib/source-document";
import {
  shouldTrackLiveTextStats,
  type SourceInspection,
  type SourceProfile,
} from "@/lib/resource-policy";
import type { FileOpenPerformanceTrace } from "@/lib/open-performance";

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
  const [sourceDocument, setSourceDocument] = useState<CodeMirrorText | null>(null);
  const [sourceProfile, setSourceProfile] = useState<SourceProfile | null>(null);
  const [sourceInspection, setSourceInspection] = useState<SourceInspection | null>(null);
  const [sourceLineSeparator, setSourceLineSeparator] = useState("\n");
  const [openPerformance, setOpenPerformance] = useState<FileOpenPerformanceTrace | null>(null);
  const fileDescriptorRef = useRef<FileDescriptor | null>(null);
  fileDescriptorRef.current = fileDescriptor;
  const sourceProfileRef = useRef<SourceProfile | null>(sourceProfile);
  sourceProfileRef.current = sourceProfile;
  const sourceInspectionRef = useRef<SourceInspection | null>(sourceInspection);
  sourceInspectionRef.current = sourceInspection;
  const [liveText, setLiveText] = useState("");
  const [forceStaticTextStats, setForceStaticTextStats] = useState(false);
  const lastSaveTimestamp = useRef(0);
  const [mainEl, setMainEl] = useState<HTMLElement | null>(null);
  const [editorInstance, setEditorInstance] = useState<Editor | null>(null);
  const [cmView, setCmView] = useState<EditorView | null>(null);
  const styleBarRef = useRef(settings.showStyleBar);
  styleBarRef.current = settings.showStyleBar;
  const fileContentRef = useRef<string | null>(null);
  const fileVersionRef = useRef<FileVersionToken | null>(null);
  const editorInstanceRef = useRef<Editor | null>(null);
  editorInstanceRef.current = editorInstance;
  const cmViewRef = useRef<EditorView | null>(null);
  cmViewRef.current = cmView;
  const mainElRef = useRef<HTMLElement | null>(null);
  mainElRef.current = mainEl;
  const closingRef = useRef(false);
  const skipNextPathLoadRef = useRef(false);
  const liveTextRef = useRef("");
  const sourceDirtyRef = useRef(false);

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
    const abortController = new AbortController();

    const loadFile = async () => {
      try {
        const model = await loadFileModel(filePath, undefined, abortController.signal);
        if (cancelled) return;
        setFileDescriptor(model.descriptor);
        setSourceDocument(model.sourceDocument);
        setSourceProfile(model.sourceProfile);
        setSourceInspection(model.sourceInspection);
        setSourceLineSeparator(model.lineSeparator);
        setOpenPerformance(model.openPerformance);
        setFileContent(model.content);
        fileContentRef.current = model.content;
        fileVersionRef.current = model.version;
        setLiveText(model.content);
        liveTextRef.current = model.content;
        setForceStaticTextStats(false);
      } catch (err) {
        if (!cancelled && !(err instanceof DOMException && err.name === "AbortError")) {
          console.error("Failed to read file:", err);
        }
      }
    };

    loadFile();
    return () => { cancelled = true; abortController.abort(); };
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
    knownDiskVersion: fileVersionRef,
    lastSaveTimestamp,
  });

  useEffect(() => {
    const flushAllSaves = async () => {
      await window.__ghostFlushEditorSave?.();
      await documentSave.flush();
    };
    window.__ghostFlushSave = flushAllSaves;
    return () => {
      if (window.__ghostFlushSave === flushAllSaves) delete window.__ghostFlushSave;
    };
  }, [documentSave.flush]);

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
      let nextSourceDocument: CodeMirrorText | null = null;
      let nextSourceProfile: SourceProfile | null = null;
      let nextSourceInspection: SourceInspection | null = null;
      let nextLineSeparator = "\n";
      try {
        const model = await loadFileModel(renamedPath);
        diskContent = model.content;
        descriptor = model.descriptor;
        fileVersionRef.current = model.version;
        nextSourceDocument = model.sourceDocument;
        nextSourceProfile = model.sourceProfile;
        nextSourceInspection = model.sourceInspection;
        nextLineSeparator = model.lineSeparator;
      } catch (error) {
        console.error("Failed to refresh renamed document:", error);
        if (isTextBackedFile(previousDescriptor) && descriptor.loadMode === "probe-text") {
          descriptor = resolveProbedText(descriptor);
        } else if (!descriptor.editable) {
          diskContent = "";
        }
      }

      const currentStringEditorText = () => {
        if (tiptapEditor && isMarkdownDocumentDirty(tiptapEditor)) {
          const pending = getPendingMarkdownDocument(tiptapEditor);
          return pending.markdown ?? serializeMarkdownDocument(tiptapEditor);
        }
        return tiptapEditor ? knownBefore : liveTextRef.current;
      };
      const retargetEditorText = (text: string) => isDirectFileRename
        ? retargetCompanionAssetReferences(text, oldPath, newPath)
        : text;
      const editorText = currentStringEditorText();
      const hadStringLocalChanges = tiptapEditor
        ? isMarkdownDocumentDirty(tiptapEditor)
        : !cmViewRef.current && editorText !== knownBefore;

      let visibleContent = diskContent;
      let visibleSourceDocument = nextSourceDocument;
      if (hadStringLocalChanges) {
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
            visibleContent = retargetEditorText(editorText);
            await documentSave.save(renamedPath, visibleContent);
          }
        } catch (error) {
          // Preserve the newest local snapshot in the replacement editor.
          // documentSave.flush() keeps close/relaunch blocked until Retry or
          // Overwrite succeeds.
          visibleContent = retargetEditorText(currentStringEditorText());
          console.error("Renamed document needs save recovery:", error);
        }
      } else if (!cmViewRef.current) {
        fileContentRef.current = diskContent;
      }

      // CodeMirror documents can be hundreds of megabytes. Preserve a dirty
      // immutable tree across the rename and stream it to the new path without
      // ever creating one giant JavaScript string. The loop drains edits made
      // while a prior snapshot is being written.
      const sourceView = cmViewRef.current;
      if (sourceView && sourceDirtyRef.current) {
        let localDocument = sourceView.state.doc;
        let visibleDocument = localDocument;
        try {
          while (true) {
            visibleDocument = isDirectFileRename
              ? retargetCompanionAssetDocument(localDocument, oldPath, newPath)
              : localDocument;
            await documentSave.saveSource(renamedPath, {
              document: visibleDocument,
              lineSeparator: sourceView.state.lineBreak,
            });
            const latestDocument = cmViewRef.current?.state.doc ?? localDocument;
            if (latestDocument === localDocument) break;
            localDocument = latestDocument;
          }
          sourceDirtyRef.current = false;
        } catch (error) {
          localDocument = cmViewRef.current?.state.doc ?? localDocument;
          visibleDocument = isDirectFileRename
            ? retargetCompanionAssetDocument(localDocument, oldPath, newPath)
            : localDocument;
          console.error("Renamed source document needs save recovery:", error);
        }

        const visibleProfile = nextSourceProfile ?? sourceProfileRef.current;
        if (visibleProfile === "large") {
          visibleSourceDocument = visibleDocument;
          visibleContent = "";
        } else {
          // Normal source documents are bounded to 20 MiB by policy.
          visibleSourceDocument = null;
          visibleContent = visibleDocument.toString();
        }
      }

      liveTextRef.current = visibleContent;
      lastSaveTimestamp.current = Date.now();
      skipNextPathLoadRef.current = true;
      setFileContent(visibleContent);
      setLiveText(visibleContent);
      setForceStaticTextStats(false);
      setFileDescriptor(descriptor);
      setSourceDocument(visibleSourceDocument);
      setSourceProfile(nextSourceProfile);
      setSourceInspection(nextSourceInspection);
      setSourceLineSeparator(nextLineSeparator);
      setFilePath(renamedPath);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [documentSave.save, documentSave.saveSource]);

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
    versionRef: fileVersionRef,
    lastSaveTimestamp,
    pendingSaveCount: documentSave.pendingSaveRef,
    hasFailedSave: documentSave.hasFailedSaveRef,
    onContentApplied: (content) => {
      setLiveText(content);
      setForceStaticTextStats(!shouldTrackLiveTextStats(
        sourceProfileRef.current,
        sourceInspectionRef.current,
        content.length,
      ));
    },
    onVersionChanged: async (path) => {
      const model = await loadFileModel(path);
      if (filePathRef.current !== path) return true;
      if (sourceProfileRef.current === "normal" && model.sourceProfile === "normal") {
        const applied = applyContentRef.current?.(model.content) ?? false;
        if (!applied) return true;
      } else {
        setFileContent(model.content);
        setSourceDocument(model.sourceDocument);
      }
      fileContentRef.current = model.content || null;
      fileVersionRef.current = model.version;
      setFileDescriptor(model.descriptor);
      setSourceProfile(model.sourceProfile);
      setSourceInspection(model.sourceInspection);
      setSourceLineSeparator(model.lineSeparator);
      setLiveText(model.sourceProfile === "normal" ? model.content : "");
      liveTextRef.current = model.sourceProfile === "normal" ? model.content : "";
      setForceStaticTextStats(false);
      return true;
    },
  });

  const handleContentChange = useCallback(
    (text: string) => {
      liveTextRef.current = text;
      setLiveText(text);
      return documentSave.save(filePathRef.current, text);
    },
    [documentSave.save]
  );

  const handleSourceChange = useCallback(
    async (snapshot: SourceDocumentSnapshot) => {
      if (shouldTrackLiveTextStats(
        sourceProfileRef.current,
        sourceInspectionRef.current,
        snapshot.document.length,
      )) {
        const text = snapshot.document.toString();
        setLiveText(text);
        liveTextRef.current = text;
      } else {
        setForceStaticTextStats(true);
      }
      await documentSave.saveSource(filePathRef.current, snapshot);
    },
    [documentSave.saveSource],
  );

  // Register window globals for Rust menu events
  useEffect(() => {
    window.__ghostFind = () => {
      if (window.__ghostViewerFind?.()) return;
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
        if (window.__ghostViewerFind?.()) return;
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
                      sourceInspection={sourceInspection}
                      forceStatic={forceStaticTextStats}
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
        <main
          ref={setMainEl}
          data-editor-scroll-container
          tabIndex={-1}
          onFocus={(event) => {
            if (event.target === event.currentTarget) focusViewerTarget(event.currentTarget);
          }}
          className="h-full overflow-auto overscroll-contain relative outline-none"
        >
          <FileViewer
            filePath={filePath}
            content={fileContent}
            onContentChange={handleContentChange}
            onSourceChange={handleSourceChange}
            searchTerm={search.searchOpen ? search.debouncedSearchTerm : ""}
            replaceTerm={search.searchOpen ? search.replaceTerm : ""}
            onSearchResults={search.handleSearchResults}
            onTiptapReady={setEditorInstance}
            onCmReady={setCmView}
            showStyleBar={settings.showStyleBar}
            onToggleStyleBar={() => updateSettings({ showStyleBar: !settings.showStyleBar })}
            descriptor={fileDescriptor}
            sourceDocument={sourceDocument}
            sourceProfile={sourceProfile}
            sourceInspection={sourceInspection}
            lineSeparator={sourceLineSeparator}
            openPerformance={openPerformance}
            onSourceDirtyChange={(dirty) => { sourceDirtyRef.current = dirty; }}
          />
        </main>
        {mdFile && editorInstance && mainEl && (
          <HeadingMinimap editor={editorInstance} scrollContainer={mainEl} />
        )}
      </div>
    </div>
  );
}
