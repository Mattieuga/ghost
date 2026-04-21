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
import { MarkdownEditor } from "@/components/editor/markdown-editor";
import { CodeEditor } from "@/components/editor/code-editor";
import { HeadingMinimap } from "@/components/editor/heading-minimap";
import { TextStats } from "@/components/editor/text-stats";
import type { Editor } from "@tiptap/react";
import type { EditorView } from "@codemirror/view";
import { isMarkdown } from "@/lib/file-type";
import { applyContentInPlace } from "@/lib/editor-utils";
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
import { CommandPalette } from "@/components/command-palette/command-palette";
import { SidebarGuide } from "@/components/sidebar/sidebar-guide";
import { useRecentFiles } from "@/hooks/use-recent-files";
import { useSearch } from "@/hooks/use-search";
import { useFileTree } from "@/hooks/use-file-tree";
import { useReloadOnFocus } from "@/hooks/use-reload-on-focus";
import { useUpdater } from "@/hooks/use-updater";
import { UpdateBanner } from "@/components/ui/update-banner";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico"]);

export function GhostLayout() {
  const { folders, loading, addFolder, addFolderByPath, removeFolder, reorderFolders, setFolderOpen, isFolderOpen } = useTrackedFolders();
  const { settings, updateSettings, saveTheme, deleteTheme } = useSettings();
  const updater = useUpdater();
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
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
  const [externalDragOver, setExternalDragOver] = useState(false);
  const treeAreaRef = useRef<HTMLDivElement>(null);
  const [mainEl, setMainEl] = useState<HTMLElement | null>(null);
  const [editorInstance, setEditorInstance] = useState<Editor | null>(null);
  const [cmView, setCmView] = useState<EditorView | null>(null);
  const activeFileRef = useRef<string | null>(null);
  activeFileRef.current = activeFile;
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
  const styleBarRef = useRef(settings.showStyleBar);
  styleBarRef.current = settings.showStyleBar;
  const { recentFiles, addRecentFile } = useRecentFiles();

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
    const sanitize = (s: string) => s.replace(/[";{}\\]/g, "");
    root.style.setProperty("--editor-text-font", `"${sanitize(settings.textFont)}"`);
    root.style.setProperty("--editor-heading-font", `"${sanitize(settings.headingFont)}"`);
    root.style.setProperty("--editor-code-font", `"${sanitize(settings.codeFont)}"`);
  }, [settings.textFont, settings.headingFont, settings.codeFont]);


  const extensions = useMemo(
    () => (settings.showAllFiles ? [] : ["md"]),
    [settings.showAllFiles]
  );

  const { flatFiles: allFiles, getEntries, getError } = useFileTree(folders, extensions, refreshTrigger);

  // Auto-remove folders that no longer exist (e.g. deleted in Finder).
  // Batch all removals to avoid cascading re-renders (one per removed folder).
  useEffect(() => {
    const broken = folders.filter((f) => getError(f));
    if (broken.length === 0) return;
    for (const folder of broken) {
      removeFolder(folder);
    }
  }, [folders, getError, removeFolder]);

  const { closeSearch, openSearch } = search;

  // Clean up orphaned assets when switching away from a file (fire-and-forget)
  const cleanupOrphanedAssets = useCallback(async (filePath: string) => {
    try {
      const fileName = filePath.substring(filePath.lastIndexOf("/") + 1);
      const stem = fileName.replace(/\.[^.]+$/, "");
      const dir = filePath.substring(0, filePath.lastIndexOf("/"));
      const assetsDir = `${dir}/${stem}.assets`;
      const assetsRef = `${stem}.assets/`;

      // Read the current saved markdown content
      const markdown = await invoke<string>("read_file", { path: filePath });

      // Collect all referenced asset filenames (simple string matching, no regex)
      const referenced = new Set<string>();
      let idx = 0;
      while ((idx = markdown.indexOf(assetsRef, idx)) !== -1) {
        const start = idx + assetsRef.length;
        // Extract filename until next whitespace, quote, or paren
        let end = start;
        while (end < markdown.length && !/[\s"')]/.test(markdown[end])) end++;
        if (end > start) referenced.add(markdown.substring(start, end));
        idx = end;
      }

      // List files on disk
      const filesOnDisk = await invoke<string[]>("list_directory_files", { path: assetsDir });

      // Delete unreferenced files in parallel
      const orphans = filesOnDisk.filter((file) => !referenced.has(file));
      await Promise.all(
        orphans.map((file) => invoke("delete_file", { path: `${assetsDir}/${file}` }).catch(() => {}))
      );

      // If directory is now empty, remove it
      if (orphans.length === filesOnDisk.length) {
        await invoke("delete_file", { path: assetsDir }).catch(() => {});
      }
    } catch {
      // Silently ignore — cleanup is best-effort
    }
  }, []);

  const handleFileSelect = useCallback(async (path: string) => {
    // Fire-and-forget cleanup of the previous file's orphaned assets
    if (activeFileRef.current && activeFileRef.current !== path) {
      cleanupOrphanedAssets(activeFileRef.current);
    }

    try {
      const content = await invoke<string>("read_file", { path });
      setActiveFile(path);
      setFileContent(content);
      fileContentRef.current = content;
      setShowSettings(false);
      closeSearch();
      addRecentFile(path);
      setLiveText(content);
    } catch (err) {
      console.error("Failed to read file:", err);
    }
  }, [closeSearch, addRecentFile, cleanupOrphanedAssets]);

  // openSearch wrapper: only open if a file is active
  const openSearchIfFile = useCallback((mode: "find" | "replace") => {
    if (!activeFileRef.current) return;
    openSearch(mode);
  }, [openSearch]);


  const handleContentChange = useCallback(
    async (markdown: string) => {
      if (!activeFile) return;
      setLiveText(markdown);
      // Update tracking state BEFORE the await. If we wait until after the
      // write resolves, a focus event that fires during a slow write (iCloud
      // sync, network home) will read the new disk content, compare against
      // the still-stale ref, and trigger a spurious in-place reload. Rolling
      // back on write failure keeps the ref honest.
      const prevContent = fileContentRef.current;
      fileContentRef.current = markdown;
      lastSaveTimestamp.current = Date.now();
      try {
        await invoke("write_file", { path: activeFile, content: markdown });
      } catch (err) {
        fileContentRef.current = prevContent;
        console.error("Failed to save file:", err);
      }
    },
    [activeFile]
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
    getPath: () => activeFileRef.current,
    applyContent: applyContentRef,
    contentRef: fileContentRef,
    lastSaveTimestamp,
    onContentApplied: (content) => setLiveText(content),
  });

  const handleFileRenamed = useCallback(
    (oldPath: string, newPath: string) => {
      if (activeFile === oldPath) setActiveFile(newPath);
      handleFsChange();
      // Notify accessory windows
      invoke("emit_file_renamed", { oldPath, newPath }).catch(() => {});
    },
    [activeFile, handleFsChange]
  );

  const handleFileDeleted = useCallback(
    (path: string) => {
      if (activeFile === path) {
        setActiveFile(null);
        setFileContent("");
      }
      handleFsChange();
      // Notify accessory windows — they will auto-close
      invoke("emit_file_deleted", { path }).catch(() => {});
    },
    [activeFile, handleFsChange]
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

      const filePath = String(active.id);
      const folderPath = (over.data.current as { folderPath?: string })?.folderPath;
      if (!folderPath) return;

      const parentDir = filePath.substring(0, filePath.lastIndexOf("/"));
      if (folderPath === parentDir) return;

      try {
        const newPath = await invoke<string>("move_file", { filePath, targetDir: folderPath });
        if (activeFile === filePath) setActiveFile(newPath);
        handleFsChange();
      } catch (err) {
        if (String(err) === "ALREADY_EXISTS") {
          setPendingMove({ filePath, targetDir: folderPath });
        } else {
          console.error("Failed to move file:", err);
        }
      }
    },
    [activeFile, handleFsChange]
  );

  // Expose functions for Rust menu events
  const createNewFile = useCallback(async () => {
    if (folders.length === 0) { addFolder(); return; }
    const currentFile = activeFileRef.current;
    const targetDir = currentFile
      ? currentFile.substring(0, currentFile.lastIndexOf("/"))
      : folders[0];
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

  useEffect(() => {
    window.__ghostAddFolder = addFolder;
    window.__ghostNewFile = createNewFile;
    window.__ghostFind = () => openSearchIfFile("find");
    window.__ghostFindAndReplace = () => openSearchIfFile("replace");
    window.__ghostCommandPalette = () => setCommandPaletteOpen((p) => !p);
    window.__ghostToggleStyleBar = () => updateSettings({ showStyleBar: !styleBarRef.current });
    return () => {
      delete window.__ghostAddFolder;
      delete window.__ghostNewFile;
      delete window.__ghostFind;
      delete window.__ghostFindAndReplace;
      delete window.__ghostCommandPalette;
      delete window.__ghostToggleStyleBar;
    };
  }, [addFolder, createNewFile, openSearchIfFile]);

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

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.shiftKey && e.key.toLowerCase() === "n") {
        // Cmd+Shift+N — new folder
        e.preventDefault();
        if (folders.length === 0) return;
        const currentFile = activeFileRef.current;
        const targetDir = currentFile
          ? currentFile.substring(0, currentFile.lastIndexOf("/"))
          : folders[0];
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
            counter++;
            name = `New Folder ${counter}`;
          }
        }
      } else if (mod && !e.shiftKey && e.key.toLowerCase() === "n") {
        // Cmd+N — new file (reuse createNewFile callback)
        e.preventDefault();
        createNewFile();
      }

      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        openSearchIfFile("find");
      }

      if (mod && e.altKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        openSearchIfFile("replace");
      }

      if (mod && e.key === "o") {
        e.preventDefault();
        addFolder();
      }

      if (mod && e.key === "\\") {
        e.preventDefault();
        toggleSidebar();
      }

      if (mod && e.key === ",") {
        e.preventDefault();
        setShowSettings((prev) => !prev);
      }

      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandPaletteOpen((prev) => {
          if (!prev) {
            // Close in-editor search when opening palette
            closeSearch();
          }
          return !prev;
        });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [folders, addFolder, createNewFile, handleFileSelect, openSearchIfFile, closeSearch]);

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

  const confirmForceMove = useCallback(() => {
    if (!pendingMove) return;
    invoke<string>("move_file", { filePath: pendingMove.filePath, targetDir: pendingMove.targetDir, force: true })
      .then((newPath) => {
        if (activeFile === pendingMove.filePath) setActiveFile(newPath);
        handleFsChange();
      })
      .catch((err) => console.error("Failed to override:", err));
    setPendingMove(null);
  }, [pendingMove, activeFile, handleFsChange]);

  const handleHeaderRename = useCallback(async () => {
    if (!activeFile || !headerRenameName || headerRenameName === activeFileName) {
      setIsRenamingHeader(false);
      return;
    }
    try {
      const newPath = await invoke<string>("rename_file", {
        oldPath: activeFile,
        newName: headerRenameName,
      });
      setActiveFile(newPath);
      handleFsChange();
      // Notify accessory windows
      invoke("emit_file_renamed", { oldPath: activeFile, newPath }).catch(() => {});
    } catch (err) {
      console.error("Failed to rename:", err);
    }
    setIsRenamingHeader(false);
  }, [activeFile, headerRenameName, activeFileName, handleFsChange]);

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
          <button
            data-sidebar-chrome
            onClick={() => setCommandPaletteOpen(true)}
            className="text-ring hover:text-sidebar-foreground transition-colors cursor-pointer"
            title="Search (⌘K)"
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
        <div ref={treeAreaRef} data-tree-area className="h-full overscroll-contain px-1 pb-12 overflow-y-auto">
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
                    activeFile={activeFile}
                    onFileSelect={handleFileSelect}
                    onRemoveFolder={(path) => {
                      removeFolder(path);
                      if (activeFile?.startsWith(path)) {
                        setActiveFile(null);
                        setFileContent("");
                      }
                    }}
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
        </div>
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
          '--editor-paragraph-spacing': `${settings.paragraphSpacing}rem`,
          '--editor-heading-spacing': `${settings.headingSpacing}rem`,
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
                <TextStats
                  text={liveText}
                  countMode={settings.countMode}
                  onCountModeChange={(countMode) => updateSettings({ countMode })}
                />
              )}
            </>
          )}
        </div>

        {/* Editor — scrolls behind the floating header */}
        <main ref={setMainEl} className="h-full overflow-auto overscroll-contain relative">
          {activeFile ? (
            isMarkdown(activeFile) ? (
              <MarkdownEditor
                key={activeFile}
                content={fileContent}
                onContentChange={handleContentChange}
                searchTerm={search.searchOpen ? search.debouncedSearchTerm : ""}
                replaceTerm={search.searchOpen ? search.replaceTerm : ""}
                onSearchResults={search.handleSearchResults}
                activeFile={activeFile}
                showStyleBar={settings.showStyleBar}
                onToggleStyleBar={() => updateSettings({ showStyleBar: !settings.showStyleBar })}
                onEditorReady={setEditorInstance}
              />
            ) : (
              <CodeEditor
                key={activeFile}
                content={fileContent}
                onContentChange={handleContentChange}
                searchTerm={search.searchOpen ? search.debouncedSearchTerm : ""}
                replaceTerm={search.searchOpen ? search.replaceTerm : ""}
                onSearchResults={search.handleSearchResults}
                activeFile={activeFile}
                onEditorReady={setCmView}
              />
            )
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="text-muted-foreground/40 text-sm">
                Select a file to start editing
              </p>
            </div>
          )}
        </main>
        {/* Heading minimap — right edge overlay (markdown only) */}
        {editorInstance && mainEl && activeFile && isMarkdown(activeFile) && (
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
          open={commandPaletteOpen}
          onClose={() => setCommandPaletteOpen(false)}
          allFiles={allFiles}
          recentFiles={recentFiles}
          onFileSelect={handleFileSelect}
          folders={folders}
          extensions={extensions}
        />
      )}
    </div>
  );
}
