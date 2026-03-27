import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
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
import { SettingsDialog } from "@/components/dialogs/settings";
import { useTrackedFolders } from "@/hooks/use-tracked-folders";
import { useFileWatcher } from "@/hooks/use-file-watcher";
import { useSettings } from "@/hooks/use-settings";
import { useTheme } from "@/components/theme-provider";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Search } from "lucide-react";

export function GhostLayout() {
  const { folders, loading, addFolder, addFolderByPath, removeFolder } = useTrackedFolders();
  const { settings, updateSettings } = useSettings();
  const { setTheme } = useTheme();
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [isRenamingHeader, setIsRenamingHeader] = useState(false);
  const [headerRenameName, setHeaderRenameName] = useState("");
  const [activeDragName, setActiveDragName] = useState<string | null>(null);
  const [wordCount, setWordCount] = useState(0);
  const [newlyCreatedFile, setNewlyCreatedFile] = useState<string | null>(null);
  const [newlyCreatedFolder, setNewlyCreatedFolder] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarHovered, setSidebarHovered] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const isResizing = useRef(false);
  const [rootFolderOpen, setRootFolderOpen] = useState<Record<string, boolean>>({});
  const [pendingMove, setPendingMove] = useState<{ filePath: string; targetDir: string } | null>(null);
  const sidebarHoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const headerInputRef = useRef<HTMLInputElement>(null);
  const activeFileRef = useRef<string | null>(null);
  activeFileRef.current = activeFile;

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  );

  useEffect(() => {
    setTheme(settings.theme);
  }, [settings.theme, setTheme]);


  const extensions = useMemo(
    () => (settings.showAllFiles ? [] : ["md"]),
    [settings.showAllFiles]
  );

  const handleFileSelect = useCallback(async (path: string) => {
    try {
      const content = await invoke<string>("read_file", { path });
      setActiveFile(path);
      setFileContent(content);
      // Count words
      const words = content.trim().split(/\s+/).filter(Boolean).length;
      setWordCount(words);
    } catch (err) {
      console.error("Failed to read file:", err);
    }
  }, []);


  const handleContentChange = useCallback(
    async (markdown: string) => {
      if (!activeFile) return;
      // Update word count
      const words = markdown.trim().split(/\s+/).filter(Boolean).length;
      setWordCount(words);
      try {
        await invoke("write_file", { path: activeFile, content: markdown });
      } catch (err) {
        console.error("Failed to save file:", err);
      }
    },
    [activeFile]
  );

  const handleFsChange = useCallback(() => {
    setRefreshTrigger((k) => k + 1);
  }, []);

  useFileWatcher(folders, handleFsChange);

  const handleFileRenamed = useCallback(
    (oldPath: string, newPath: string) => {
      if (activeFile === oldPath) setActiveFile(newPath);
      handleFsChange();
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__ghostAddFolder = addFolder;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__ghostNewFile = createNewFile;
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).__ghostAddFolder;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).__ghostNewFile;
    };
  }, [addFolder, createNewFile]);

  // Handle files opened from Finder (file associations)
  const openExternalFile = useCallback(async (filePath: string) => {
    const parentDir = filePath.substring(0, filePath.lastIndexOf("/"));

    // Add parent folder if not already tracked
    const isTracked = folders.some((f) => filePath.startsWith(f + "/") || filePath.startsWith(f));
    if (!isTracked) {
      addFolderByPath(parentDir);
      handleFsChange();
    }

    // Open the file
    handleFileSelect(filePath);
  }, [folders, addFolderByPath, handleFileSelect, handleFsChange]);

  // Check for files opened during cold start
  useEffect(() => {
    if (loading) return; // Wait for tracked folders to load
    invoke<string[]>("get_pending_open_files").then((paths) => {
      if (paths.length > 0) {
        openExternalFile(paths[0]);
      }
    }).catch(() => {});
  }, [loading, openExternalFile]);

  // Listen for files opened while app is running
  useEffect(() => {
    const unlisten = listen<string>("file-open", (event) => {
      openExternalFile(event.payload);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [openExternalFile]);

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
        // Cmd+N — new file
        e.preventDefault();
        if (folders.length === 0) {
          addFolder();
          return;
        }
        const currentFile = activeFileRef.current;
        const targetDir = currentFile
          ? currentFile.substring(0, currentFile.lastIndexOf("/"))
          : folders[0];
        let name = "Untitled.md";
        let counter = 1;
        while (counter < 100) {
          try {
            const path = await invoke<string>("create_file", {
              dir: targetDir,
              name,
            });
            setNewlyCreatedFile(path);
            handleFsChange();
            handleFileSelect(path);
            break;
          } catch {
            counter++;
            name = `Untitled ${counter}.md`;
          }
        }
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
        setShowSettings(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [folders, addFolder, handleFileSelect]);

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
      setSidebarHovered(false);
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

  // Which folders have the active file
  const folderHasActiveFile = useCallback((folderPath: string) => {
    return activeFile ? activeFile.startsWith(folderPath + "/") : false;
  }, [activeFile]);

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
    } catch (err) {
      console.error("Failed to rename:", err);
    }
    setIsRenamingHeader(false);
  }, [activeFile, headerRenameName, activeFileName, handleFsChange]);

  return (
    <div className="flex h-svh w-full overflow-hidden relative">
      {/* Collapsed dots — only visible when sidebar is collapsed and not hovered */}
      {sidebarCollapsed && !sidebarHovered && (
        <div
          className="absolute left-0 top-0 bottom-0 w-10 z-20"
          onMouseEnter={handleSidebarMouseEnter}
        >
          {/* Drag region for traffic lights */}
          <div className="h-12" data-tauri-drag-region />
          {/* Project dots — positioned to match sidebar's first dot location */}
          {/* Title bar 48px + search 48px + WORKSPACE label ~28px = ~124px, minus the 48px title bar above = 76px */}
          <div className="flex flex-col items-start gap-[22px]" style={{ paddingLeft: "19px", paddingTop: "76px" }}>
            {folders.map((folder) => {
              const hasActive = folderHasActiveFile(folder);
              const isOpen = rootFolderOpen[folder] !== false; // default to open
              const dotColor = hasActive ? "#f57c00" : "#52525b";
              return (
                <span
                  key={folder}
                  className="inline-block size-[7px] shrink-0 rounded-full transition-colors cursor-pointer"
                  style={{
                    backgroundColor: isOpen ? dotColor : "transparent",
                    border: `1.5px solid ${dotColor}`,
                  }}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Sidebar — expanded or overlay (always rendered when collapsed for animation) */}
      <div
        className={`flex flex-col bg-sidebar overflow-hidden transition-transform duration-150 ease-out
          ${sidebarCollapsed ? "absolute left-0 top-0 bottom-0 z-30 shadow-2xl shadow-black/50 w-[240px]" : "relative border-r border-sidebar-border"}
          ${sidebarCollapsed && !sidebarHovered ? "-translate-x-full" : "translate-x-0"}`}
        style={!sidebarCollapsed ? { width: `${sidebarWidth}px`, minWidth: `${SIDEBAR_MIN}px`, flexShrink: 0 } : undefined}
        onMouseEnter={handleSidebarMouseEnter}
        onMouseLeave={handleSidebarMouseLeave}
      >
        {/* Sidebar title bar — drag region for traffic lights */}
        <div
          className="h-12 shrink-0"
          data-tauri-drag-region
        />

        {/* Search bar (UI only) */}
        <div className="px-3 pt-0 pb-4">
          <div className="flex items-center gap-2 h-8 px-3 rounded-[6px] bg-[#18181b] text-[13px] cursor-pointer">
            <Search className="size-3.5 text-[#3f3f46]" />
            <span className="flex-1 text-[#3f3f46]">Search...</span>
            <kbd className="text-[11px] font-medium text-[#3f3f46]">&#8984;K</kbd>
          </div>
        </div>

        {/* Folder tree */}
        <ContextMenu>
        <ContextMenuTrigger asChild>
        <div className="flex-1 overflow-y-auto overscroll-contain px-1">
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
                <div className="flex items-center justify-between px-4 pb-2 pt-1">
                  <span className="text-[10px] font-medium uppercase text-[#3f3f46]" style={{ letterSpacing: "1.2px" }}>
                    Workspace
                  </span>
                  <button
                    onClick={addFolder}
                    className="text-[#3f3f46] hover:text-[#71717a] transition-colors cursor-pointer text-[16px] leading-none"
                    title="Add folder (⌘O)"
                  >
                    +
                  </button>
                </div>
                {folders.map((folder) => (
                  <FolderTree
                    key={folder}
                    path={folder}
                    extensions={extensions}
                    activeFile={activeFile}
                    refreshTrigger={refreshTrigger}
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
                    onRootOpenChange={(path, isOpen) => setRootFolderOpen(prev => ({ ...prev, [path]: isOpen }))}
                    onAddProject={addFolder}
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
        </ContextMenuTrigger>
        <ContextMenuContent className="w-56" onCloseAutoFocus={(e) => e.preventDefault()}>
          <ContextMenuItem onSelect={addFolder}>
            Open New Project
            <ContextMenuShortcut>⌘O</ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuContent>
        </ContextMenu>

        {/* Footer — Settings + Collapse */}
        <div className="shrink-0 border-t border-sidebar-border px-4 py-3 flex items-center justify-between">
          <button
            onClick={() => setShowSettings(true)}
            className="text-[13px] text-[#3f3f46] hover:text-[#71717a] transition-colors cursor-pointer"
          >
            Settings
          </button>
          <button
            onClick={toggleSidebar}
            className="text-[#3f3f46] hover:text-[#71717a] transition-colors cursor-pointer"
            title={sidebarCollapsed ? "Expand sidebar (⌘\\)" : "Collapse sidebar (⌘\\)"}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              {sidebarCollapsed ? (
                <path d="M6 3L11 8L6 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              ) : (
                <path d="M10 3L5 8L10 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              )}
            </svg>
          </button>
        </div>

        {/* Resize handle */}
        {!sidebarCollapsed && (
          <div
            className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize z-10 border-r border-sidebar-border"
            onMouseDown={handleResizeStart}
          />
        )}
      </div>

      {/* Main content — full height, no top bar */}
      <div className="relative flex-1 overflow-hidden bg-background">
        {/* Floating header overlay — semi-transparent, content scrolls behind */}
        <div
          className={`absolute top-0 left-0 right-0 z-10 flex h-12 items-center justify-between bg-background/80 backdrop-blur-sm ${
            sidebarCollapsed ? "pl-[100px] pr-8" : "px-8"
          }`}
          data-tauri-drag-region
        >
          <div className="flex items-center gap-1 text-[13px] pointer-events-auto">
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
                className="h-6 text-[13px] px-1 w-48 bg-transparent"
              />
            ) : breadcrumb ? (
              <>
                <span className="text-[#52525b] pointer-events-none select-none">{breadcrumb.folderName}</span>
                <span className="text-[#3f3f46] mx-1 pointer-events-none select-none">/</span>
                <span
                  className="text-[#a1a1aa] font-medium cursor-pointer hover:text-[#71717a] transition-colors"
                  onClick={startHeaderRename}
                >
                  {breadcrumb.fileName}
                </span>
              </>
            ) : null}
          </div>
          {activeFile && (
            <span className="text-[12px] text-[#3f3f46] pointer-events-none select-none">
              {wordCount} words
            </span>
          )}
        </div>

        {/* Editor — scrolls behind the floating header */}
        <main className="h-full overflow-auto overscroll-contain">
          {activeFile ? (
            <MarkdownEditor
              key={activeFile}
              content={fileContent}
              onContentChange={handleContentChange}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="text-muted-foreground/40 text-sm">
                Select a file to start editing
              </p>
            </div>
          )}
        </main>
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

      <SettingsDialog
        open={showSettings}
        onOpenChange={setShowSettings}
        settings={settings}
        onUpdateSettings={updateSettings}
      />
    </div>
  );
}
