import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
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
import { FolderTree } from "@/components/sidebar/folder-tree";
import { EmptyState } from "@/components/sidebar/empty-state";
import { MarkdownEditor } from "@/components/editor/markdown-editor";
import { SettingsDialog } from "@/components/dialogs/settings";
import { useTrackedFolders } from "@/hooks/use-tracked-folders";
import { useFileWatcher } from "@/hooks/use-file-watcher";
import { useSettings } from "@/hooks/use-settings";
import { useTheme } from "@/components/theme-provider";
import { Search } from "lucide-react";

export function GhostLayout() {
  const { folders, loading, addFolder, removeFolder } = useTrackedFolders();
  const { settings, updateSettings } = useSettings();
  const { setTheme } = useTheme();
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [isRenamingHeader, setIsRenamingHeader] = useState(false);
  const [headerRenameName, setHeaderRenameName] = useState("");
  const [activeDragName, setActiveDragName] = useState<string | null>(null);
  const [wordCount, setWordCount] = useState(0);
  const [newlyCreatedFile, setNewlyCreatedFile] = useState<string | null>(null);
  const [newlyCreatedFolder, setNewlyCreatedFolder] = useState<string | null>(null);
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
      setSelectedItem(path);
      // Count words
      const words = content.trim().split(/\s+/).filter(Boolean).length;
      setWordCount(words);
    } catch (err) {
      console.error("Failed to read file:", err);
    }
  }, []);

  const handleFolderSelect = useCallback((path: string) => {
    setSelectedItem(path);
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
      if (selectedItem === oldPath) setSelectedItem(newPath);
      handleFsChange();
    },
    [activeFile, selectedItem, handleFsChange]
  );

  const handleFileDeleted = useCallback(
    (path: string) => {
      if (activeFile === path) {
        setActiveFile(null);
        setFileContent("");
      }
      if (selectedItem === path) setSelectedItem(null);
      handleFsChange();
    },
    [activeFile, selectedItem, handleFsChange]
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
        console.error("Failed to move file:", err);
      }
    },
    [activeFile, handleFsChange]
  );

  // Expose functions for Rust menu events
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__ghostAddFolder = addFolder;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return () => { delete (window as any).__ghostAddFolder; };
  }, [addFolder]);

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
        while (true) {
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
        while (true) {
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
      setSelectedItem(newPath);
      handleFsChange();
    } catch (err) {
      console.error("Failed to rename:", err);
    }
    setIsRenamingHeader(false);
  }, [activeFile, headerRenameName, activeFileName, handleFsChange]);

  return (
    <div className="flex h-svh w-full overflow-hidden">
      {/* Sidebar — 240px, has its own title bar area */}
      <div className="flex w-[240px] shrink-0 flex-col bg-sidebar border-r border-sidebar-border">
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
                    selectedItem={selectedItem}
                    refreshTrigger={refreshTrigger}
                    onFileSelect={handleFileSelect}
                    onFolderSelect={handleFolderSelect}
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

        {/* Footer — Settings + Collapse */}
        <div className="shrink-0 border-t border-sidebar-border px-4 py-3 flex items-center justify-between">
          <button
            onClick={() => setShowSettings(true)}
            className="text-[13px] text-[#3f3f46] hover:text-[#71717a] transition-colors cursor-pointer"
          >
            Settings
          </button>
          <button
            className="text-[#3f3f46] hover:text-[#71717a] transition-colors cursor-pointer"
            title="Collapse sidebar"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M10 3L5 8L10 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Main content — full height, no top bar */}
      <div className="relative flex-1 overflow-hidden bg-background">
        {/* Floating header overlay — semi-transparent, content scrolls behind */}
        <div className="absolute top-0 left-0 right-0 z-10 flex h-11 items-center justify-between px-8 bg-background/80 backdrop-blur-sm" data-tauri-drag-region>
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

      <SettingsDialog
        open={showSettings}
        onOpenChange={setShowSettings}
        settings={settings}
        onUpdateSettings={updateSettings}
      />
    </div>
  );
}
