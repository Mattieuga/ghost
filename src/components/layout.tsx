import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { handleImageFromPath } from "@/components/editor/image-extension";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FolderTree } from "@/components/sidebar/folder-tree";
import { EmptyState } from "@/components/sidebar/empty-state";
import { HeadingMinimap } from "@/components/editor/heading-minimap";
import { fontFamilyValue } from "@/lib/fonts";
import { FileViewer } from "@/components/editor/file-viewer";
import { TextStats } from "@/components/editor/text-stats";
import { SaveStatus } from "@/components/editor/save-status";
import type { Editor } from "@tiptap/react";
import type { EditorView } from "@codemirror/view";
import {
  classifyFile,
  isTextBackedFile,
  resolveProbedText,
  type FileDescriptor,
} from "@/lib/file-type";
import { loadFileModel } from "@/lib/file-loader";
import { OpenExternalButton } from "@/components/viewer/open-external-button";
import { ActiveFileStore, ActiveFileProvider } from "@/components/sidebar/sidebar-context";
import { applyContentInPlace, focusViewerTarget } from "@/lib/editor-utils";
import { SettingsPage } from "@/components/settings/settings-page";
import { useTrackedFolders } from "@/hooks/use-tracked-folders";
import { useFileWatcher } from "@/hooks/use-file-watcher";
import { useSettings } from "@/hooks/use-settings";
import { applyTheme } from "@/lib/theme-engine";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Search, SlidersHorizontal } from "lucide-react";
import { SearchBar } from "@/components/editor/search-bar";
import {
  CommandPalette,
  type CommandPaletteCloseReason,
  type CommandPaletteMode,
  type PaletteCommand,
} from "@/components/command-palette/command-palette";
import { SidebarGuide } from "@/components/sidebar/sidebar-guide";
import {
  FileTreeKeyboard,
  type FileTreeKeyboardHandle,
} from "@/components/sidebar/file-tree-keyboard";
import { useRecentFiles } from "@/hooks/use-recent-files";
import { useCloseSearchWhenUnavailable, useSearch } from "@/hooks/use-search";
import { useFileTree } from "@/hooks/use-file-tree";
import { useReloadOnFocus } from "@/hooks/use-reload-on-focus";
import { useUpdater } from "@/hooks/use-updater";
import { useDocumentSave } from "@/hooks/use-document-save";
import { retargetPath } from "@/lib/file-path";
import { UpdateBanner } from "@/components/ui/update-banner";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico"]);

export function GhostLayout() {
  const { folders, loading, addFolder, addFolderByPath, removeFolder, renameFolder, reorderFolders, setFolderOpen, isFolderOpen } = useTrackedFolders();
  const { settings, updateSettings, saveTheme, deleteTheme } = useSettings();
  const updater = useUpdater();
  const [activeFileStore] = useState(() => new ActiveFileStore());
  const [activeFile, _setActiveFile] = useState<string | null>(null);
  const activeFileRef = useRef<string | null>(null);
  const backHistoryRef = useRef<string[]>([]);
  const forwardHistoryRef = useRef<string[]>([]);
  const recentCycleRef = useRef<{ paths: string[]; index: number } | null>(null);
  const openRequestRef = useRef(0);
  const setActiveFile = useCallback((path: string | null) => {
    activeFileRef.current = path;
    _setActiveFile(path);
    activeFileStore.set(path);
  }, [activeFileStore]);
  const [fileContent, setFileContent] = useState<string>("");
  const [fileDescriptor, setFileDescriptor] = useState<FileDescriptor | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [isRenamingHeader, setIsRenamingHeader] = useState(false);
  const [headerRenameName, setHeaderRenameName] = useState("");
  const [activeDragName, setActiveDragName] = useState<string | null>(null);
  const [liveText, setLiveText] = useState("");
  const [newlyCreatedFile, setNewlyCreatedFile] = useState<string | null>(null);
  const [newlyCreatedFolder, setNewlyCreatedFolder] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarHovered, setSidebarHovered] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const isResizing = useRef(false);
  const [pendingMove, setPendingMove] = useState<{ filePath: string; targetDir: string } | null>(null);
  const search = useSearch();
  const sidebarHoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sidebarCollapsedAt = useRef<number>(0);
  const sidebarContextMenuOpen = useRef(false);
  const headerInputRef = useRef<HTMLInputElement>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandPaletteMode, setCommandPaletteMode] = useState<CommandPaletteMode>("files");
  const paletteReturnFocusRef = useRef<HTMLElement | null>(null);
  const [externalDragOver, setExternalDragOver] = useState(false);
  const treeAreaRef = useRef<HTMLDivElement>(null);
  const treeKeyboardRef = useRef<FileTreeKeyboardHandle>(null);
  const [mainEl, setMainEl] = useState<HTMLElement | null>(null);
  const [editorInstance, setEditorInstance] = useState<Editor | null>(null);
  const [cmView, setCmView] = useState<EditorView | null>(null);
  // Last known on-disk content. Used by useReloadOnFocus to detect genuine
  // external changes. Updated on initial load, on successful saves, and when
  // we apply an external change. Deliberately NOT bound to fileContent state
  // (which only feeds the initial prop to <MarkdownEditor>).
  const fileContentRef = useRef<string | null>(null);
  const editorInstanceRef = useRef<Editor | null>(null);
  editorInstanceRef.current = editorInstance;
  const cmViewRef = useRef<EditorView | null>(null);
  cmViewRef.current = cmView;
  const mainElRef = useRef<HTMLElement | null>(null);
  mainElRef.current = mainEl;
  const lastSaveTimestamp = useRef(0);
  const retargetPromiseRef = useRef<Promise<void> | null>(null);
  const fileDescriptorRef = useRef<FileDescriptor | null>(fileDescriptor);
  fileDescriptorRef.current = fileDescriptor;
  const styleBarRef = useRef(settings.showStyleBar);
  styleBarRef.current = settings.showStyleBar;
  const {
    recentFiles,
    addRecentFile,
    retargetRecentFiles,
    removeRecentFiles,
  } = useRecentFiles();

  const focusEditor = useCallback(() => {
    requestAnimationFrame(() => {
      const tiptap = editorInstanceRef.current;
      if (tiptap && !tiptap.isDestroyed) {
        tiptap.commands.focus();
        return;
      }
      const codeMirror = cmViewRef.current;
      if (codeMirror) {
        codeMirror.focus();
        return;
      }
      if (focusViewerTarget(mainElRef.current)) return;
      mainElRef.current?.focus({ preventScroll: true });
    });
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  );

  useEffect(() => {
    applyTheme(settings.themeColors, settings.theme, settings.syntaxPalette);
  }, [settings.themeColors, settings.theme, settings.syntaxPalette]);

  // Apply font settings directly on :root for reliable cascade in WKWebView
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--editor-text-font", fontFamilyValue(settings.textFont));
    root.style.setProperty("--editor-heading-font", fontFamilyValue(settings.headingFont));
    root.style.setProperty("--editor-code-font", fontFamilyValue(settings.codeFont));
  }, [settings.textFont, settings.headingFont, settings.codeFont]);


  const extensions = useMemo(
    () => (settings.showAllFiles ? [] : ["md"]),
    [settings.showAllFiles]
  );

  const { flatFiles: allFiles, getEntries, getError, expandFolder, isSkippedDir } = useFileTree(folders, extensions, refreshTrigger);

  const { closeSearch, openSearch } = search;

  // A rename can change the active viewer without going through openFile.
  useCloseSearchWhenUnavailable(fileDescriptor?.searchable, closeSearch);

  const openCommandPalette = useCallback((mode: CommandPaletteMode) => {
    if (!document.querySelector("[data-command-palette]")) {
      paletteReturnFocusRef.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    }
    closeSearch();
    setCommandPaletteMode(mode);
    setCommandPaletteOpen(true);
  }, [closeSearch]);

  const closeCommandPalette = useCallback((reason: CommandPaletteCloseReason = "cancel") => {
    setCommandPaletteOpen(false);
    const returnTarget = paletteReturnFocusRef.current;
    paletteReturnFocusRef.current = null;
    requestAnimationFrame(() => {
      if (reason === "selection") focusEditor();
      else if (returnTarget?.isConnected) returnTarget.focus();
      else focusEditor();
    });
  }, [focusEditor]);

  const openFile = useCallback(async (path: string, recordHistory = true): Promise<boolean> => {
    const requestId = ++openRequestRef.current;
    const previousPath = activeFileRef.current;
    if (activeFileRef.current && activeFileRef.current !== path) {
      try {
        await window.__ghostFlushSave?.();
      } catch {
        // Keep the current editor open; its save status explains the failure.
        return false;
      }
    }

    try {
      setShowSettings(false);
      closeSearch();

      const model = await loadFileModel(path);

      if (requestId !== openRequestRef.current) return false;

      if (recordHistory && previousPath && previousPath !== path) {
        const back = backHistoryRef.current;
        if (back[back.length - 1] !== previousPath) back.push(previousPath);
        if (back.length > 100) back.splice(0, back.length - 100);
        forwardHistoryRef.current = [];
      }

      fileContentRef.current = model.content;
      setFileDescriptor(model.descriptor);
      setActiveFile(path);
      setFileContent(model.content);
      setLiveText(model.content);
      addRecentFile(path);
      return true;
    } catch (err) {
      console.error("Failed to read file:", err);
      return false;
    }
  }, [closeSearch, addRecentFile, setActiveFile]);

  const handleFileSelect = useCallback(
    (path: string) => openFile(path, true),
    [openFile],
  );

  const handlePaletteFileSelect = useCallback(async (path: string) => {
    if (!await openFile(path, true)) return false;
    await treeKeyboardRef.current?.revealPath(path);
    return true;
  }, [openFile]);

  const navigateBack = useCallback(async () => {
    const target = backHistoryRef.current[backHistoryRef.current.length - 1];
    const current = activeFileRef.current;
    if (!target || !current) return;
    if (await openFile(target, false)) {
      backHistoryRef.current.pop();
      if (forwardHistoryRef.current[forwardHistoryRef.current.length - 1] !== current) {
        forwardHistoryRef.current.push(current);
      }
    }
  }, [openFile]);

  const navigateForward = useCallback(async () => {
    const target = forwardHistoryRef.current[forwardHistoryRef.current.length - 1];
    const current = activeFileRef.current;
    if (!target || !current) return;
    if (await openFile(target, false)) {
      forwardHistoryRef.current.pop();
      if (backHistoryRef.current[backHistoryRef.current.length - 1] !== current) {
        backHistoryRef.current.push(current);
      }
    }
  }, [openFile]);

  const cycleRecentFile = useCallback(async (reverse: boolean) => {
    let cycle = recentCycleRef.current;
    if (!cycle) {
      const paths = recentFiles.filter((path) => path !== activeFileRef.current);
      if (paths.length === 0) return;
      cycle = { paths, index: reverse ? paths.length - 1 : 0 };
      recentCycleRef.current = cycle;
    } else {
      const offset = reverse ? -1 : 1;
      cycle.index = (cycle.index + offset + cycle.paths.length) % cycle.paths.length;
    }

    const target = cycle.paths[cycle.index];
    if (target) await openFile(target, true);
  }, [openFile, recentFiles]);

  // openSearch wrapper: only open if a file is active
  const openSearchIfFile = useCallback((mode: "find" | "replace") => {
    if (mode === "find" && window.__ghostViewerFind?.()) return;
    if (!activeFileRef.current || !fileDescriptorRef.current?.searchable) return;
    openSearch(mode);
  }, [openSearch]);


  const documentSave = useDocumentSave({
    knownDiskContent: fileContentRef,
    lastSaveTimestamp,
  });

  const handleContentChange = useCallback(
    async (markdown: string) => {
      // A rename can rewrite companion asset references on disk. Wait for
      // that fresh snapshot before checking expectedContent or choosing the
      // destination path for this edit.
      await retargetPromiseRef.current;
      const path = activeFileRef.current;
      if (!path) return;
      setLiveText(markdown);
      await documentSave.save(path, markdown);
    },
    [documentSave.save]
  );

  const handleFsChange = useCallback(() => {
    setRefreshTrigger((k) => k + 1);
  }, []);

  useFileWatcher(folders, handleFsChange);

  const applyContentRef = useRef<((content: string) => boolean) | null>(null);
  applyContentRef.current = (content) =>
    applyContentInPlace(editorInstanceRef, cmViewRef, mainElRef, content);

  // Reload active file when the main window regains focus (picks up edits
  // from accessory windows). Applies external changes in place, no remount.
  useReloadOnFocus({
    getPath: () => isTextBackedFile(fileDescriptorRef.current) ? activeFileRef.current : null,
    applyContent: applyContentRef,
    contentRef: fileContentRef,
    lastSaveTimestamp,
    pendingSaveCount: documentSave.pendingSaveRef,
    hasFailedSave: documentSave.hasFailedSaveRef,
    onContentApplied: (content) => setLiveText(content),
  });

  const retargetNavigationHistory = useCallback((oldPath: string, newPath: string) => {
    const retarget = (path: string) => retargetPath(path, oldPath, newPath) ?? path;
    backHistoryRef.current = backHistoryRef.current.map(retarget);
    forwardHistoryRef.current = forwardHistoryRef.current.map(retarget);
    if (recentCycleRef.current) {
      recentCycleRef.current.paths = recentCycleRef.current.paths.map(retarget);
    }
    retargetRecentFiles(oldPath, newPath);
  }, [retargetRecentFiles]);

  const removeFromNavigationHistory = useCallback((removedPath: string) => {
    const keep = (path: string) => path !== removedPath && !path.startsWith(`${removedPath}/`);
    backHistoryRef.current = backHistoryRef.current.filter(keep);
    forwardHistoryRef.current = forwardHistoryRef.current.filter(keep);
    if (recentCycleRef.current) {
      recentCycleRef.current.paths = recentCycleRef.current.paths.filter(keep);
    }
    removeRecentFiles(removedPath);
  }, [removeRecentFiles]);

  const retargetActiveFile = useCallback((oldPath: string, newPath: string): Promise<string | null> => {
    // History and recents may contain the renamed item even when it is not
    // currently open, so keep navigation state in sync unconditionally.
    retargetNavigationHistory(oldPath, newPath);
    const currentFile = activeFileRef.current;
    if (!currentFile) return Promise.resolve(null);

    const renamedPath = retargetPath(currentFile, oldPath, newPath);
    if (!renamedPath) return Promise.resolve(null);
    const previousDescriptor = fileDescriptorRef.current;

    const retarget = (async () => {
      // Saves must target the new path immediately, even while the rewritten
      // Markdown is being read for the editor remount.
      activeFileRef.current = renamedPath;
      activeFileStore.set(renamedPath);

      let content = fileContentRef.current ?? "";
      let descriptor = classifyFile(renamedPath);
      try {
        const model = await loadFileModel(renamedPath);
        content = model.content;
        descriptor = model.descriptor;
      } catch (error) {
        console.error("Failed to refresh renamed file:", error);
        if (isTextBackedFile(previousDescriptor) && descriptor.loadMode === "probe-text") {
          descriptor = resolveProbedText(descriptor);
        } else if (!descriptor.editable) {
          content = "";
        }
      }

      // rename_file can also rename <stem>.assets and rewrite image paths.
      // Use its on-disk result so images stay resolved without a reopen.
      fileContentRef.current = content;
      lastSaveTimestamp.current = Date.now();
      setFileContent(content);
      setLiveText(content);
      setFileDescriptor(descriptor);
      setActiveFile(renamedPath);
      return renamedPath;
    })();

    const barrier = retarget.then(() => undefined);
    retargetPromiseRef.current = barrier;
    void barrier.finally(() => {
      if (retargetPromiseRef.current === barrier) retargetPromiseRef.current = null;
    });
    return retarget;
  }, [activeFileStore, retargetNavigationHistory, setActiveFile]);

  const handleFileRenamed = useCallback(
    async (oldPath: string, newPath: string) => {
      await retargetActiveFile(oldPath, newPath);
      handleFsChange();
      // Notify accessory windows
      invoke("emit_file_renamed", { oldPath, newPath }).catch(() => {});
    },
    [retargetActiveFile, handleFsChange]
  );

  const handleRootRenamed = useCallback(
    async (oldPath: string, newPath: string) => {
      renameFolder(oldPath, newPath);
      await handleFileRenamed(oldPath, newPath);
    },
    [renameFolder, handleFileRenamed]
  );

  const handleFileDeleted = useCallback(
    (path: string) => {
      removeFromNavigationHistory(path);
      const currentFile = activeFileRef.current;
      if (currentFile && (currentFile === path || currentFile.startsWith(path + "/"))) {
        setActiveFile(null);
        setFileDescriptor(null);
        setFileContent("");
      }
      handleFsChange();
      // Notify accessory windows — they will auto-close
      invoke("emit_file_deleted", { path }).catch(() => {});
    },
    [setActiveFile, handleFsChange, removeFromNavigationHistory]
  );

  // dnd-kit handlers
  const [activeDropFolder, setActiveDropFolder] = useState<string | null>(null);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const name = (event.active.data.current as { name?: string })?.name;
    setActiveDragName(name ?? String(event.active.id));
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const folderPath = (event.over?.data.current as { folderPath?: string })?.folderPath ?? null;
    setActiveDropFolder(folderPath);
  }, []);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActiveDragName(null);
      setActiveDropFolder(null);
      const { active, over } = event;
      if (!over) return;

      const filePath = (active.data.current as { path?: string })?.path ?? String(active.id);
      const folderPath = (over.data.current as { folderPath?: string })?.folderPath;
      if (!folderPath) return;

      const parentDir = filePath.substring(0, filePath.lastIndexOf("/"));
      if (folderPath === parentDir) return;

      try {
        await window.__ghostFlushSave?.();
        const newPath = await invoke<string>("move_file", { filePath, targetDir: folderPath });
        await retargetActiveFile(filePath, newPath);
        handleFsChange();
      } catch (err) {
        if (String(err) === "ALREADY_EXISTS") {
          setPendingMove({ filePath, targetDir: folderPath });
        } else {
          console.error("Failed to move file:", err);
        }
      }
    },
    [retargetActiveFile, handleFsChange]
  );

  // Expose functions for Rust menu events
  const createNewFile = useCallback(async (targetDirectory?: string) => {
    if (folders.length === 0) { addFolder(); return; }
    const currentFile = activeFileRef.current;
    const keyboardTarget = treeKeyboardRef.current?.hasFocus()
      ? treeKeyboardRef.current.getTargetDirectory()
      : null;
    const targetDir = targetDirectory
      ?? keyboardTarget
      ?? (currentFile
        ? currentFile.substring(0, currentFile.lastIndexOf("/"))
        : folders[0]);
    let name = "Untitled.md";
    let counter = 1;
    while (true) {
      try {
        const path = await invoke<string>("create_file", { dir: targetDir, name });
        setNewlyCreatedFile(path);
        handleFsChange();
        handleFileSelect(path);
        break;
      } catch {
        counter++;
        name = `Untitled ${counter}.md`;
        if (counter > 100) break;
      }
    }
  }, [folders, addFolder, handleFileSelect, handleFsChange]);

  const createNewFolder = useCallback(async (targetDirectory?: string) => {
    if (folders.length === 0) { addFolder(); return; }
    const currentFile = activeFileRef.current;
    const keyboardTarget = treeKeyboardRef.current?.hasFocus()
      ? treeKeyboardRef.current.getTargetDirectory()
      : null;
    const targetDir = targetDirectory
      ?? keyboardTarget
      ?? (currentFile
        ? currentFile.substring(0, currentFile.lastIndexOf("/"))
        : folders[0]);

    let name = "New Folder";
    let counter = 1;
    while (counter < 100) {
      try {
        const path = await invoke<string>("create_directory", {
          parent: targetDir,
          name,
        });
        setNewlyCreatedFolder(path);
        handleFsChange();
        break;
      } catch {
        counter += 1;
        name = `New Folder ${counter}`;
      }
    }
  }, [folders, addFolder, handleFsChange]);

  useEffect(() => {
    window.__ghostAddFolder = addFolder;
    window.__ghostNewFile = createNewFile;
    window.__ghostFind = () => openSearchIfFile("find");
    window.__ghostFindAndReplace = () => openSearchIfFile("replace");
    window.__ghostCommandPalette = () => openCommandPalette("commands");
    window.__ghostQuickOpen = () => openCommandPalette("files");
    window.__ghostSearchContents = () => openCommandPalette("content");
    window.__ghostFocusEditor = focusEditor;
    window.__ghostNavigateBack = () => { void navigateBack(); };
    window.__ghostNavigateForward = () => { void navigateForward(); };
    window.__ghostSettings = () => setShowSettings((previous) => !previous);
    window.__ghostToggleStyleBar = () => updateSettings({ showStyleBar: !styleBarRef.current });
    return () => {
      delete window.__ghostAddFolder;
      delete window.__ghostNewFile;
      delete window.__ghostFind;
      delete window.__ghostFindAndReplace;
      delete window.__ghostCommandPalette;
      delete window.__ghostQuickOpen;
      delete window.__ghostSearchContents;
      delete window.__ghostFocusEditor;
      delete window.__ghostNavigateBack;
      delete window.__ghostNavigateForward;
      delete window.__ghostSettings;
      delete window.__ghostToggleStyleBar;
    };
  }, [
    addFolder,
    createNewFile,
    focusEditor,
    navigateBack,
    navigateForward,
    openCommandPalette,
    openSearchIfFile,
    updateSettings,
  ]);

  // Finder file-open events are now handled by Rust (opens accessory windows directly)

  // Listen for external file/folder drag-drop from Finder
  useEffect(() => {
    const unlistenEnter = listen<{ paths: string[]; position: { x: number; y: number } }>("tauri://drag-enter", (event) => {
      if (!event.payload.paths?.length) return;

      // Only show sidebar drop zone for folders or markdown files, not pure image drags
      const paths = event.payload.paths;
      const imageExts = IMAGE_EXTENSIONS;
      const allImages = paths.every((p) => {
        const ext = p.substring(p.lastIndexOf(".")).toLowerCase();
        return imageExts.has(ext);
      });

      // If dragging only images and there's an active editor, don't show sidebar overlay
      // (images go to the editor instead)
      if (allImages && activeFileRef.current) return;

      setExternalDragOver(true);
    });
    const unlistenLeave = listen("tauri://drag-leave", () => {
      setExternalDragOver(false);
    });
    const unlistenDrop = listen<{ paths: string[]; position: { x: number; y: number } }>("tauri://drag-drop", async (event) => {
      setExternalDragOver(false);
      const paths = event.payload.paths;
      if (!paths || paths.length === 0) return;

      // Check if the drop landed over the editor area
      const { x, y } = event.payload.position;
      const editorEl = document.querySelector(".ghost-editor");
      const isOverEditor = (() => {
        if (!editorEl || !activeFileRef.current) return false;
        const rect = editorEl.getBoundingClientRect();
        return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
      })();

      const imageExts = IMAGE_EXTENSIONS;

      for (const droppedPath of paths) {
        try {
          const isDir = await invoke<boolean>("is_directory", { path: droppedPath });
          if (isDir) {
            addFolderByPath(droppedPath);
            handleFsChange();
          } else {
            // If image dropped over editor, insert it inline
            const ext = droppedPath.substring(droppedPath.lastIndexOf(".")).toLowerCase();
            if (isOverEditor && imageExts.has(ext)) {
              // Save to {stem}.assets/ folder and insert into editor
              const relativePath = await handleImageFromPath(droppedPath);
              if (relativePath) {
                window.dispatchEvent(new CustomEvent("ghost-insert-image", { detail: { src: relativePath } }));
              }
            } else {
              // Open non-image files in an accessory window
              invoke("open_editor_window", { filePath: droppedPath });
            }
          }
        } catch (err) {
          console.error("Failed to handle dropped path:", err);
        }
      }
    });

    return () => {
      unlistenEnter.then((fn) => fn());
      unlistenLeave.then((fn) => fn());
      unlistenDrop.then((fn) => fn());
    };
  }, [addFolderByPath, handleFsChange]);

  // Breadcrumb from active file
  const breadcrumb = useMemo(() => {
    if (!activeFile) return null;
    const parts = activeFile.split("/");
    // Get folder name and filename
    const fileName = parts[parts.length - 1];
    const folderName = parts[parts.length - 2] || "";
    return { folderName, fileName };
  }, [activeFile]);

  const activeFileName = breadcrumb?.fileName ?? null;

  // Header rename
  const startHeaderRename = useCallback(() => {
    if (!activeFileName) return;
    setHeaderRenameName(activeFileName);
    setIsRenamingHeader(true);
  }, [activeFileName]);

  useEffect(() => {
    if (isRenamingHeader && headerInputRef.current) {
      headerInputRef.current.focus();
      const dotIndex = headerRenameName.lastIndexOf(".");
      if (dotIndex > 0) {
        headerInputRef.current.setSelectionRange(0, dotIndex);
      } else {
        headerInputRef.current.select();
      }
    }
  }, [isRenamingHeader]);

  // Sidebar hover handlers for collapsed mode
  const handleSidebarMouseEnter = useCallback(() => {
    if (!sidebarCollapsed) return;
    // Ignore hover shortly after collapsing to prevent immediate re-open
    if (Date.now() - sidebarCollapsedAt.current < 500) return;
    if (sidebarHoverTimeout.current) {
      clearTimeout(sidebarHoverTimeout.current);
      sidebarHoverTimeout.current = null;
    }
    sidebarHoverTimeout.current = setTimeout(() => {
      setSidebarHovered(true);
    }, 200);
  }, [sidebarCollapsed]);

  const handleSidebarMouseLeave = useCallback(() => {
    if (!sidebarCollapsed) return;
    if (sidebarHoverTimeout.current) {
      clearTimeout(sidebarHoverTimeout.current);
      sidebarHoverTimeout.current = null;
    }
    sidebarHoverTimeout.current = setTimeout(() => {
      if (!sidebarContextMenuOpen.current) {
        setSidebarHovered(false);
      }
    }, 200);
  }, [sidebarCollapsed]);

  const SIDEBAR_MIN = 180;
  const SIDEBAR_MAX = 400;
  const EDITOR_MIN = 390; // 300px content + 90px padding

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const maxForWindow = window.innerWidth - EDITOR_MIN;
      const newWidth = Math.min(SIDEBAR_MAX, maxForWindow, Math.max(SIDEBAR_MIN, startWidth + (e.clientX - startX)));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      isResizing.current = false;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  }, [sidebarWidth]);

  const toggleSidebar = useCallback(async () => {
    const willExpand = sidebarCollapsed;
    if (willExpand) {
      // Expanding — grow window if needed to fit sidebar + editor min
      const needed = sidebarWidth + EDITOR_MIN;
      const windowWidth = window.innerWidth;
      if (windowWidth < needed) {
        try {
          await getCurrentWindow().setSize(new LogicalSize(needed, window.innerHeight));
        } catch (err) {
          console.error("Failed to resize window:", err);
        }
      }
    } else {
      sidebarCollapsedAt.current = Date.now();
    }
    setSidebarCollapsed((c) => !c);
    setSidebarHovered(false);
  }, [sidebarCollapsed, sidebarWidth]);

  const focusFileTree = useCallback(async () => {
    if (sidebarCollapsed) await toggleSidebar();
    requestAnimationFrame(() => {
      void treeKeyboardRef.current?.focusActive();
    });
  }, [sidebarCollapsed, toggleSidebar]);

  useEffect(() => {
    window.__ghostFocusTree = () => { void focusFileTree(); };
    window.__ghostToggleSidebar = () => { void toggleSidebar(); };
    return () => {
      delete window.__ghostFocusTree;
      delete window.__ghostToggleSidebar;
    };
  }, [focusFileTree, toggleSidebar]);

  // Application-level shortcuts. Tree-specific unmodified keys are handled
  // by FileTreeKeyboard so they never interfere with editor typing.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
      const command = event.metaKey || (!isMac && event.ctrlKey);

      if (event.ctrlKey && !event.metaKey && event.key === "Tab") {
        event.preventDefault();
        void cycleRecentFile(event.shiftKey);
        return;
      }
      if (
        event.ctrlKey &&
        !event.metaKey &&
        (event.code === "Minus" || event.key === "-" || event.key === "_")
      ) {
        event.preventDefault();
        void (event.shiftKey ? navigateForward() : navigateBack());
        return;
      }
      if (command && event.shiftKey && key === "e") {
        event.preventDefault();
        void focusFileTree();
        return;
      }
      if (command && !event.shiftKey && key === "1") {
        event.preventDefault();
        focusEditor();
        return;
      }
      if (command && key === "p") {
        event.preventDefault();
        openCommandPalette(event.shiftKey ? "commands" : "files");
        return;
      }
      if (command && event.shiftKey && key === "f") {
        event.preventDefault();
        openCommandPalette("content");
        return;
      }
      if (command && key === "k") {
        event.preventDefault();
        openCommandPalette("commands");
        return;
      }
      if (command && event.shiftKey && key === "n") {
        event.preventDefault();
        void createNewFolder();
        return;
      }
      if (command && !event.shiftKey && key === "n") {
        event.preventDefault();
        void createNewFile();
        return;
      }
      if (command && key === "o") {
        event.preventDefault();
        addFolder();
        return;
      }
      if (command && event.key === "\\") {
        event.preventDefault();
        void toggleSidebar();
        return;
      }
      if (command && event.key === ",") {
        event.preventDefault();
        setShowSettings((previous) => !previous);
        return;
      }
      if (command && !event.shiftKey && !event.altKey && key === "f") {
        event.preventDefault();
        openSearchIfFile("find");
        return;
      }
      if (command && event.altKey && key === "f") {
        event.preventDefault();
        openSearchIfFile("replace");
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Control") recentCycleRef.current = null;
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [
    addFolder,
    createNewFile,
    createNewFolder,
    cycleRecentFile,
    focusEditor,
    focusFileTree,
    navigateBack,
    navigateForward,
    openCommandPalette,
    openSearchIfFile,
    toggleSidebar,
  ]);

  // Dynamic window min size based on sidebar state
  useEffect(() => {
    const minWidth = sidebarCollapsed ? EDITOR_MIN : SIDEBAR_MIN + EDITOR_MIN;
    getCurrentWindow().setSizeConstraints({
      minWidth,
      minHeight: 300,
    }).catch(() => {});
  }, [sidebarCollapsed]);

  // Track context menu open state to prevent sidebar hiding
  useEffect(() => {
    const sidebar = document.querySelector("[data-sidebar-collapsed]");
    if (!sidebar) return;
    const handleContextMenu = () => {
      if (sidebarCollapsed) sidebarContextMenuOpen.current = true;
    };
    const handlePointerDown = () => {
      if (sidebarContextMenuOpen.current) {
        sidebarContextMenuOpen.current = false;
        // Re-check if mouse is still over sidebar
        setSidebarHovered(false);
      }
    };
    sidebar.addEventListener("contextmenu", handleContextMenu);
    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      sidebar.removeEventListener("contextmenu", handleContextMenu);
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [sidebarCollapsed]);

  // Set stagger indexes on tree labels for sequential fade-in
  useEffect(() => {
    if (sidebarHovered && sidebarCollapsed) {
      const labels = document.querySelectorAll("[data-tree-label]");
      labels.forEach((el, i) => {
        (el as HTMLElement).style.setProperty("--tree-index", String(i));
      });
    }
  }, [sidebarHovered, sidebarCollapsed]);

  // Shrink sidebar when window is too small for sidebar + editor min
  useEffect(() => {
    const handleResize = () => {
      if (sidebarCollapsed) return;
      const windowWidth = window.innerWidth;
      if (windowWidth < sidebarWidth + EDITOR_MIN) {
        const newWidth = Math.max(SIDEBAR_MIN, windowWidth - EDITOR_MIN);
        setSidebarWidth(newWidth);
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [sidebarWidth, sidebarCollapsed]);

  const confirmForceMove = useCallback(async () => {
    if (!pendingMove) return;
    try {
      await window.__ghostFlushSave?.();
      const newPath = await invoke<string>("move_file", {
        filePath: pendingMove.filePath,
        targetDir: pendingMove.targetDir,
        force: true,
      });
      await retargetActiveFile(pendingMove.filePath, newPath);
      handleFsChange();
      setPendingMove(null);
    } catch (err) {
      console.error("Failed to override:", err);
    }
  }, [pendingMove, retargetActiveFile, handleFsChange]);

  const handleHeaderRename = useCallback(async () => {
    if (!activeFile || !headerRenameName || headerRenameName === activeFileName) {
      setIsRenamingHeader(false);
      return;
    }
    try {
      await window.__ghostFlushSave?.();
      const newPath = await invoke<string>("rename_file", {
        oldPath: activeFile,
        newName: headerRenameName,
      });
      await retargetActiveFile(activeFile, newPath);
      handleFsChange();
      // Notify accessory windows
      invoke("emit_file_renamed", { oldPath: activeFile, newPath }).catch(() => {});
    } catch (err) {
      console.error("Failed to rename:", err);
      return;
    }
    setIsRenamingHeader(false);
  }, [activeFile, headerRenameName, activeFileName, retargetActiveFile, handleFsChange]);

  const focusedTreeNode = treeKeyboardRef.current?.getFocusedNode() ?? null;
  const focusedTreeDetail = focusedTreeNode
    ? `${focusedTreeNode.kind === "folder" ? "Folder" : "File"}: ${focusedTreeNode.label}`
    : "Focus the file tree first";
  const focusedTreeDirectory = treeKeyboardRef.current?.getTargetDirectory() ?? undefined;

  const paletteCommands: PaletteCommand[] = [
    {
      id: "navigation.goToFile",
      title: "Go to File…",
      shortcut: "⌘P",
      keywords: "quick open recent",
      closeOnRun: false,
      run: () => openCommandPalette("files"),
    },
    {
      id: "navigation.searchContents",
      title: "Search File Contents…",
      shortcut: "⇧⌘F",
      keywords: "global workspace text",
      closeOnRun: false,
      run: () => openCommandPalette("content"),
    },
    {
      id: "navigation.focusTree",
      title: "Focus File Tree",
      shortcut: "⇧⌘E",
      run: focusFileTree,
    },
    {
      id: "navigation.focusEditor",
      title: "Focus Editor",
      shortcut: "⌘1",
      run: focusEditor,
    },
    {
      id: "navigation.back",
      title: "Go Back",
      shortcut: "⌃-",
      run: navigateBack,
    },
    {
      id: "navigation.forward",
      title: "Go Forward",
      shortcut: "⌃⇧-",
      run: navigateForward,
    },
    {
      id: "file.new",
      title: "New File",
      shortcut: "⌘N",
      detail: focusedTreeDirectory ? `In ${focusedTreeDirectory}` : undefined,
      run: () => createNewFile(focusedTreeDirectory),
    },
    {
      id: "folder.new",
      title: "New Folder",
      shortcut: "⇧⌘N",
      detail: focusedTreeDirectory ? `In ${focusedTreeDirectory}` : undefined,
      run: () => createNewFolder(focusedTreeDirectory),
    },
    {
      id: "tree.open",
      title: "Open Focused Tree Item",
      detail: focusedTreeDetail,
      disabled: !focusedTreeNode,
      run: () => treeKeyboardRef.current?.runFocusedAction("activate"),
    },
    {
      id: "tree.openNewWindow",
      title: "Open Focused File in New Window",
      shortcut: "⌘↵",
      detail: focusedTreeDetail,
      disabled: focusedTreeNode?.kind !== "file",
      run: () => treeKeyboardRef.current?.runFocusedAction("openNewWindow"),
    },
    {
      id: "tree.rename",
      title: "Rename Focused Tree Item…",
      shortcut: "F2",
      detail: focusedTreeDetail,
      disabled: !focusedTreeNode,
      run: () => treeKeyboardRef.current?.runFocusedAction("rename"),
    },
    {
      id: "tree.duplicate",
      title: "Duplicate Focused Tree Item",
      shortcut: "⌘D",
      detail: focusedTreeDetail,
      disabled: !focusedTreeNode,
      run: () => treeKeyboardRef.current?.runFocusedAction("duplicate"),
    },
    {
      id: "tree.copyPath",
      title: "Copy Path of Focused Tree Item",
      detail: focusedTreeDetail,
      disabled: !focusedTreeNode,
      run: () => treeKeyboardRef.current?.runFocusedAction("copyPath"),
    },
    {
      id: "tree.reveal",
      title: "Reveal Focused Tree Item in Finder",
      detail: focusedTreeDetail,
      disabled: !focusedTreeNode,
      run: () => treeKeyboardRef.current?.runFocusedAction("reveal"),
    },
    {
      id: "tree.trash",
      title: "Move Focused Tree Item to Trash…",
      shortcut: "⌘⌫",
      detail: focusedTreeDetail,
      disabled: !focusedTreeNode || (focusedTreeNode.kind === "folder" && folders.includes(focusedTreeNode.path)),
      run: () => treeKeyboardRef.current?.runFocusedAction("trash"),
    },
    {
      id: "workspace.addProject",
      title: "Open New Project…",
      shortcut: "⌘O",
      run: addFolder,
    },
    {
      id: "view.toggleSidebar",
      title: sidebarCollapsed ? "Expand Sidebar" : "Collapse Sidebar",
      shortcut: "⌘\\",
      run: toggleSidebar,
    },
    {
      id: "view.toggleStyleBar",
      title: settings.showStyleBar ? "Hide Style Bar" : "Show Style Bar",
      shortcut: "⇧⌘Y",
      run: () => updateSettings({ showStyleBar: !settings.showStyleBar }),
    },
    {
      id: "settings.open",
      title: "Open Settings",
      shortcut: "⌘,",
      run: () => setShowSettings(true),
    },
  ];

  return (
    <div
      className="flex h-svh w-full overflow-hidden relative"
      data-sidebar-state={sidebarCollapsed ? (sidebarHovered ? "collapsed-hovered" : "collapsed") : "expanded"}
    >
      {/* Sidebar — always rendered, same DOM across all states */}
      <div
        data-sidebar-collapsed={sidebarCollapsed || undefined}
        data-sidebar-hovered={sidebarHovered || undefined}
        className={`flex flex-col
          ${sidebarCollapsed
            ? `absolute left-0 top-0 bottom-0 z-30 ${sidebarHovered ? "overflow-hidden" : "overflow-visible"}`
            : "relative bg-sidebar border-r border-sidebar-border overflow-hidden"
          }`}
        style={{
          width: sidebarCollapsed ? (sidebarHovered ? 260 : 40) : sidebarWidth,
          ...(sidebarCollapsed ? {} : { minWidth: SIDEBAR_MIN, flexShrink: 0 }),
        }}
        onMouseEnter={handleSidebarMouseEnter}
        onMouseLeave={handleSidebarMouseLeave}
      >
        {/* Backdrop blur overlay for collapsed hover */}
        <div data-sidebar-backdrop />

        {/* Sidebar title bar — drag region for traffic lights + settings */}
        <div
          className="h-12 shrink-0 flex items-center justify-end gap-3 px-3"
          data-tauri-drag-region
        >
          {__GHOST_DEV_BUILD__ && (
            <span
              data-sidebar-chrome
              className="pointer-events-none max-w-[7rem] truncate rounded border border-ghost-amber/40 bg-ghost-amber/10 px-1.5 py-0.5 text-[9px] font-semibold leading-none tracking-[0.12em] text-ghost-amber whitespace-nowrap"
              title={__GHOST_DEV_WORKSPACE__ ? `Worktree: ${__GHOST_DEV_WORKSPACE__}` : "Development build"}
            >
              {__GHOST_DEV_LABEL__}
            </span>
          )}
          <button
            data-sidebar-chrome
            onClick={() => openCommandPalette("files")}
            className="text-ring hover:text-sidebar-foreground transition-colors cursor-pointer"
            title="Go to File (⌘P)"
          >
            <Search className="size-[15px]" strokeWidth={2.25} />
          </button>
          <button
            data-sidebar-chrome
            onClick={() => setShowSettings(true)}
            className="text-ring hover:text-sidebar-foreground transition-colors cursor-pointer"
            title="Settings (⌘,)"
          >
            <SlidersHorizontal className="size-[15px]" strokeWidth={2.25} />
          </button>
        </div>

        {/* Folder tree — ALWAYS rendered, same component, same DOM */}
        <ContextMenu>
        <ContextMenuTrigger asChild>
        <div className="flex-1 relative overflow-hidden">
        <FileTreeKeyboard
          ref={treeKeyboardRef}
          scrollRef={treeAreaRef}
          activePath={activeFile}
          onFocusEditor={focusEditor}
          className="h-full overscroll-contain px-1 pb-12 overflow-y-auto outline-none"
        >
          <ActiveFileProvider value={activeFileStore}>
          <DndContext
            sensors={sensors}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
          >
            {loading ? null : folders.length === 0 ? (
              <EmptyState onAddFolder={addFolder} />
            ) : (
              <div>
                <div data-sidebar-chrome className="flex items-center justify-between px-4 pb-2 pt-1">
                  <span className="text-[10px] font-medium uppercase text-ring" style={{ letterSpacing: "1.2px" }}>
                    Workspace
                  </span>
                  <button
                    onClick={addFolder}
                    className="text-ring hover:text-sidebar-foreground transition-colors cursor-pointer text-[16px] leading-none"
                    title="Add folder (⌘O)"
                  >
                    +
                  </button>
                </div>
                {folders.map((folder, folderIndex) => (
                  <FolderTree
                    key={folder}
                    path={folder}
                    folderIndex={folderIndex}
                    folderCount={folders.length}
                    onReorderProject={reorderFolders}
                    entries={getEntries(folder)}
                    error={getError(folder)}
                    onRefreshFolder={handleFsChange}
                    onFileSelect={handleFileSelect}
                    onRemoveFolder={async (path) => {
                      try {
                        await window.__ghostFlushSave?.();
                      } catch {
                        return;
                      }
                      removeFromNavigationHistory(path);
                      removeFolder(path);
                      if (activeFile?.startsWith(path)) {
                        setActiveFile(null);
                        setFileDescriptor(null);
                        setFileContent("");
                      }
                    }}
                    onRootRenamed={handleRootRenamed}
                    onFileRenamed={handleFileRenamed}
                    onFileDeleted={handleFileDeleted}
                    newlyCreatedFile={newlyCreatedFile}
                    onNewFileCreated={(path) => { setNewlyCreatedFile(path); handleFsChange(); }}
                    onNewFileRenamed={() => setNewlyCreatedFile(null)}
                    newlyCreatedFolder={newlyCreatedFolder}
                    onNewFolderCreated={(path) => setNewlyCreatedFolder(path)}
                    onNewFolderRenamed={() => setNewlyCreatedFolder(null)}
                    activeDropFolder={activeDropFolder}
                    onAddProject={addFolder}
                    defaultOpen={isFolderOpen(folder)}
                    onRootOpenChange={setFolderOpen}
                    onExpandFolder={expandFolder}
                    isSkippedDir={isSkippedDir}
                  />
                ))}
              </div>
            )}
            <DragOverlay dropAnimation={null}>
              {activeDragName ? (
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-popover/80 border shadow-md text-xs opacity-75 scale-90">
                  <span>{activeDragName}</span>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
          </ActiveFileProvider>
        </FileTreeKeyboard>
        <SidebarGuide treeAreaRef={treeAreaRef} />
        </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-56" onCloseAutoFocus={(e) => e.preventDefault()}>
          <ContextMenuItem onSelect={addFolder}>
            Open New Project
            <ContextMenuShortcut>⌘O</ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuContent>
        </ContextMenu>

        {/* External file/folder drop zone */}
        {externalDragOver && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-sidebar/90 border-2 border-dashed border-ring rounded-lg m-1">
            <div className="flex flex-col items-center gap-2 pointer-events-none">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-muted-foreground" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span className="text-[12px] font-medium text-muted-foreground">Drop to open</span>
            </div>
          </div>
        )}

        {/* Resize handle — only when expanded */}
        {!sidebarCollapsed && (
          <div
            className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize z-10 border-r border-sidebar-border"
            onMouseDown={handleResizeStart}
          />
        )}
      </div>

      {/* Floating sidebar collapse toggle */}
      <button
        onClick={toggleSidebar}
        onMouseEnter={(e) => {
          e.stopPropagation();
          // Cancel any pending sidebar hover when mouse is on the chevron
          if (sidebarHoverTimeout.current) {
            clearTimeout(sidebarHoverTimeout.current);
            sidebarHoverTimeout.current = null;
          }
        }}
        className="absolute bottom-3 left-2 z-40 text-ring hover:text-sidebar-foreground transition-colors cursor-pointer size-8 flex items-center justify-center rounded-full bg-background/80 backdrop-blur-sm"
        title={sidebarCollapsed ? "Expand sidebar (⌘\\)" : "Collapse sidebar (⌘\\)"}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="transition-transform duration-150 ease-out"
          style={{ transform: sidebarCollapsed ? "scaleX(-1)" : "scaleX(1)" }}
        >
          <path d="M10 3L5 8L10 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {/* Main content — full height, no top bar */}
      <div
        className="relative flex-1 overflow-hidden bg-background"
        style={{
          '--editor-font-size': `${settings.fontSize}px`,
          '--editor-line-height': `${settings.lineHeight}`,
          '--editor-max-width': `${settings.editorWidth}px`,
          '--editor-block-spacing': `${settings.blockSpacing}rem`,
          '--editor-heading-spacing': `${settings.headingSpacing}rem`,
          '--editor-heading-after-spacing': `${settings.headingAfterSpacing}rem`,
        } as React.CSSProperties}
      >
        {/* Floating header overlay — semi-transparent, content scrolls behind */}
        <div
          className={`absolute top-0 left-0 right-0 z-10 flex h-12 items-center justify-between bg-background/80 backdrop-blur-sm ${
            sidebarCollapsed ? "pl-[100px] pr-8" : "px-8"
          }`}
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
                onClose={closeSearch}
                onToggleMode={() => search.setSearchMode(m => m === "find" ? "replace" : "find")}
                searchInputRef={search.searchInputRef}
              />
            </div>
          ) : (
            <>
              <div className="flex items-center min-w-0 flex-1 text-[13px] pointer-events-none">
                {isRenamingHeader ? (
                  <Input
                    ref={headerInputRef}
                    value={headerRenameName}
                    onChange={(e) => setHeaderRenameName(e.target.value)}
                    onBlur={handleHeaderRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleHeaderRename();
                      if (e.key === "Escape") setIsRenamingHeader(false);
                    }}
                    className="h-6 text-[13px] px-1 w-48 bg-transparent pointer-events-auto"
                  />
                ) : breadcrumb ? (
                  <div className="flex items-center min-w-0 overflow-hidden">
                    <span className="text-muted-foreground pointer-events-none select-none truncate" style={{ flexShrink: 10 }}>{breadcrumb.folderName}</span>
                    <span className="text-ring mx-1 pointer-events-none select-none shrink-0">/</span>
                    <span
                      className="text-sidebar-primary font-medium cursor-pointer hover:text-sidebar-foreground transition-colors truncate pointer-events-auto"
                      style={{ flexShrink: 1 }}
                      onClick={startHeaderRename}
                    >
                      {breadcrumb.fileName}
                    </span>
                  </div>
                ) : null}
              </div>
              {activeFile && (
                <div className="flex items-center gap-3">
                  {fileDescriptor?.editable ? (
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
                  ) : fileDescriptor?.canOpenExternally ? (
                    <OpenExternalButton filePath={activeFile} />
                  ) : null}
                </div>
              )}
            </>
          )}
        </div>

        {/* Editor — scrolls behind the floating header */}
        <main
          ref={setMainEl}
          tabIndex={-1}
          onFocus={(event) => {
            if (event.target === event.currentTarget) focusViewerTarget(event.currentTarget);
          }}
          className="h-full overflow-auto overscroll-contain relative outline-none"
        >
          {activeFile && fileDescriptor ? (
            <FileViewer
              filePath={activeFile}
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
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="text-muted-foreground/40 text-sm">
                Select a file to start editing
              </p>
            </div>
          )}
        </main>
        {/* Heading minimap — right edge overlay (markdown only) */}
        {editorInstance && mainEl && fileDescriptor?.kind === "markdown" && (
          <HeadingMinimap editor={editorInstance} scrollContainer={mainEl} />
        )}
      </div>

      {/* Override confirmation for drag move */}
      <Dialog open={!!pendingMove} onOpenChange={(open) => { if (!open) setPendingMove(null); }}>
        <DialogContent onKeyDown={(e) => { if (e.key === "Enter") confirmForceMove(); }}>
          <DialogHeader>
            <DialogTitle>File already exists</DialogTitle>
            <DialogDescription>
              A file with the same name already exists in the target folder. Do you want to replace it?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingMove(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmForceMove}>
              Replace
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {showSettings && (
        <SettingsPage
          settings={settings}
          onUpdateSettings={updateSettings}
          onClose={() => setShowSettings(false)}
          customThemes={settings.customThemes}
          onSaveTheme={saveTheme}
          onDeleteTheme={deleteTheme}
          updater={updater}
        />
      )}

      {!showSettings && <UpdateBanner updater={updater} />}

      {commandPaletteOpen && (
        <CommandPalette
          key={commandPaletteMode}
          open={commandPaletteOpen}
          initialMode={commandPaletteMode}
          onClose={closeCommandPalette}
          allFiles={allFiles}
          recentFiles={recentFiles}
          onFileSelect={handlePaletteFileSelect}
          folders={folders}
          extensions={extensions}
          commands={paletteCommands}
        />
      )}
    </div>
  );
}
