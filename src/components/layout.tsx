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
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarProvider,
  SidebarGroup,
  SidebarGroupLabel,
} from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FolderTree } from "@/components/sidebar/folder-tree";
import { EmptyState } from "@/components/sidebar/empty-state";
import { MarkdownEditor } from "@/components/editor/markdown-editor";
import { SettingsDialog } from "@/components/dialogs/settings";
import { useTrackedFolders } from "@/hooks/use-tracked-folders";
import { useFileWatcher } from "@/hooks/use-file-watcher";
import { useSettings } from "@/hooks/use-settings";
import { useTheme } from "@/components/theme-provider";
import { FileText, FolderPlus, Ghost, Settings } from "lucide-react";

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
  const headerInputRef = useRef<HTMLInputElement>(null);

  // dnd-kit sensors — PointerSensor with 5px activation distance
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

      // Don't move into the same parent
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

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key === "n") {
        e.preventDefault();
        if (folders.length === 0) {
          addFolder();
          return;
        }
        const targetDir = folders[0];
        let name = "Untitled.md";
        let counter = 1;
        while (true) {
          try {
            const path = await invoke<string>("create_file", {
              dir: targetDir,
              name,
            });
            await handleFileSelect(path);
            break;
          } catch {
            counter++;
            name = `Untitled ${counter}.md`;
          }
        }
      }

      if (mod && e.key === ",") {
        e.preventDefault();
        setShowSettings(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [folders, addFolder, handleFileSelect]);

  const activeFileName = useMemo(() => {
    if (!activeFile) return null;
    const parts = activeFile.split("/");
    return parts[parts.length - 1];
  }, [activeFile]);

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
    <SidebarProvider defaultOpen={true}>
      <Sidebar collapsible="none">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg">
                <Ghost className="size-5" />
                <span className="font-semibold tracking-tight">Ghost</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          <DndContext
            sensors={sensors}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
          >
            {loading ? null : folders.length === 0 ? (
              <EmptyState onAddFolder={addFolder} />
            ) : (
              <SidebarGroup>
                <SidebarGroupLabel className="flex items-center justify-between">
                  <span>Folders</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-5"
                    onClick={addFolder}
                  >
                    <FolderPlus className="size-3.5" />
                  </Button>
                </SidebarGroupLabel>
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
                    activeDropFolder={activeDropFolder}
                  />
                ))}
              </SidebarGroup>
            )}
            <DragOverlay dropAnimation={null}>
              {activeDragName ? (
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-popover/80 border shadow-md text-xs opacity-75 scale-90">
                  <FileText className="size-3 shrink-0" />
                  <span>{activeDragName}</span>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </SidebarContent>

        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => setShowSettings(true)}
                className="cursor-pointer"
              >
                <Settings className="size-4" />
                <span>Settings</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset>
        <header className="flex h-10 shrink-0 items-center gap-2 border-b px-4">
          <Separator orientation="vertical" className="h-4" />
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
              className="h-6 text-sm px-1 w-48"
            />
          ) : (
            <span
              className={`text-sm truncate ${
                activeFileName
                  ? "text-foreground cursor-pointer hover:text-muted-foreground"
                  : "text-muted-foreground"
              }`}
              onClick={activeFileName ? startHeaderRename : undefined}
            >
              {activeFileName ?? "No file selected"}
            </span>
          )}
        </header>
        <main className="flex-1 overflow-auto overscroll-contain">
          {activeFile ? (
            <MarkdownEditor
              key={activeFile}
              content={fileContent}
              onContentChange={handleContentChange}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="text-muted-foreground text-sm">
                Select a file to start editing
              </p>
            </div>
          )}
        </main>
      </SidebarInset>

      <SettingsDialog
        open={showSettings}
        onOpenChange={setShowSettings}
        settings={settings}
        onUpdateSettings={updateSettings}
      />
    </SidebarProvider>
  );
}
