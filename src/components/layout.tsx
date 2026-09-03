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
import { DocumentHeader } from "@/components/editor/document-header";
import { fontFamilyValue } from "@/lib/fonts";
import { FileViewer } from "@/components/editor/file-viewer";
import { TextStats } from "@/components/editor/text-stats";
import { SaveStatus } from "@/components/editor/save-status";
import type { Editor } from "@tiptap/react";
import { EditorView } from "@codemirror/view";
import type { Text as CodeMirrorText } from "@codemirror/state";
import {
  classifyFile,
  isTextBackedFile,
  resolveProbedText,
  type FileDescriptor,
} from "@/lib/file-type";
import { localDocumentRef } from "@/lib/document-ref";
import { tauriLocalDocumentSource } from "@/lib/local-document-source";
import { OpenExternalButton } from "@/components/viewer/open-external-button";
import {
  ActiveFileStore,
  ActiveFileProvider,
  SidebarActionsProvider,
  type SidebarActions,
} from "@/components/sidebar/sidebar-context";
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
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, Search, SlidersHorizontal } from "lucide-react";
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
import type { FileVersionToken, SourceDocumentSnapshot } from "@/lib/source-document";
import {
  shouldTrackLiveTextStats,
  type SourceInspection,
  type SourceProfile,
} from "@/lib/resource-policy";
import type { FileOpenPerformanceTrace } from "@/lib/open-performance";
import { ensureNotesFolder, ghostFolder } from "@/lib/ghost-folder";
import { tauriMarkdownEditorActions } from "@/components/editor/tauri-markdown-editor";
import { AppNotification } from "@/components/ui/app-notification";
import { MirroredDocumentEditor } from "@/mirror/mirrored-document-editor";
import { MirrorSaveStatus } from "@/mirror/mirror-save-status";
import { MirroredRootNotice } from "@/mirror/mirrored-root-notice";
import { StopSyncingDialog, SyncFolderDialog } from "@/mirror/sync-folder-dialog";
import { readGhostFolder } from "@/lib/mirror/adoption";
import { relativeToRoot } from "@/lib/mirror/ghost-index";
import { tauriMirrorFs, type FsEvent } from "@/lib/mirror/mirror-fs";
import { reconcileMirroredRoot, relocateDocument } from "@/lib/mirror/root-sync";
import { trashCloudItem } from "@/cloud/cloud-data";
import type { MirrorWriteStatus } from "@/lib/mirror/mirror-writer";
import {
  resolveMirroredRoot,
  type RootResolution,
  type RootResolutionFs,
} from "@/lib/mirror/root-resolution";
import {
  describeSyncOutcome,
  linkIntoRepository,
  performSync,
  stopSyncing,
} from "@/lib/mirror/sync-folder";
import { SidebarMutedRow, SidebarSectionHeader } from "@/components/sidebar/sidebar-section-header";
import { SidebarTrashDialog } from "@/components/sidebar/sidebar-trash-dialog";
import type { TrackedRoot } from "@/hooks/use-tracked-folders";
import { getMacCloudClient, MAC_CLOUD_AUTH_REDIRECT_URL, openMacCloudOAuthUrl } from "@/cloud/mac-cloud-client";
import { mirrorLocalPersistenceKey, openYjsPersistence } from "@/cloud/cloud-local-persistence";
import { isMissingServerFunction, uploadMirroredRoot } from "@/lib/mirror/cloud-upload";
import type * as Y from "yjs";
import { pullCloudChanges } from "@/lib/mirror/cloud-pull";
import { refreshSharedRoot, SHARED_FOLDER_NAME } from "@/lib/mirror/shared-root";
import {
  acceptCloudInvitations,
  isMissingSharingFunction,
  leaveCloudItem,
  listVisibleCloudItems,
} from "@/cloud/cloud-sharing";
import { ShareSheet, type SignInSurfaceProps } from "@/mirror/share-sheet";
import { useCloudAccount } from "@/cloud/use-cloud-account";
import { completeMacCloudAuthCallback, useMacCloudAuthCallback } from "@/cloud/use-mac-cloud-auth-callback";
import { open as openFolderDialog } from "@tauri-apps/plugin-dialog";

/** Cloud refresh cadence: at most every 20 s on focus, and every 5 min regardless. */
const CLOUD_REFRESH_MIN_MS = 20_000;
const CLOUD_REFRESH_INTERVAL_MS = 5 * 60_000;

/** The root that contains a path: the deepest one, so a synced subfolder of a plain root wins. */
function rootForPath(roots: TrackedRoot[], path: string): TrackedRoot | null {
  let best: TrackedRoot | null = null;
  for (const root of roots) {
    if (path === root.path || path.startsWith(`${root.path}/`)) {
      if (!best || root.path.length > best.path.length) best = root;
    }
  }
  return best;
}

function insideRoot(root: TrackedRoot | null, path: string | null | undefined): boolean {
  return Boolean(root && path && (path === root.path || path.startsWith(`${root.path}/`)));
}

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico"]);

export function GhostLayout() {
  const {
    roots,
    folders,
    loading,
    firstRun,
    addFolder,
    addFolderByPath,
    ensureSharedRoot,
    removeFolder,
    renameFolder,
    setRootOrder,
    setRootKind,
    updateRoot,
    updateRootPath,
    setFolderOpen,
    isFolderOpen,
  } = useTrackedFolders();
  const { settings, updateSettings, saveTheme, deleteTheme } = useSettings();
  const updater = useUpdater();
  const [activeFileStore] = useState(() => new ActiveFileStore());
  const [mirrorStatus, setMirrorStatus] = useState<{ status: MirrorWriteStatus; error: string | null }>({
    status: "saved",
    error: null,
  });
  const [mirrorNotification, setMirrorNotification] = useState<string | null>(null);
  const mirrorFlushRef = useRef<(() => Promise<void>) | null>(null);
  const mirroredActiveRef = useRef(false);
  const [syncDialogPath, setSyncDialogPath] = useState<string | null>(null);
  const [stopSyncingRoot, setStopSyncingRoot] = useState<TrackedRoot | null>(null);
  const [rootResolutions, setRootResolutions] = useState<Record<string, RootResolution>>({});
  const rootResolutionsRef = useRef(rootResolutions);
  rootResolutionsRef.current = rootResolutions;
  // Roots with an upload in flight, and roots whose upload failed this
  // session (retried at the next sign-in). Both keep other loops off them.
  const uploadingRoots = useRef(new Set<string>());
  const failedUploads = useRef(new Set<string>());
  const [pendingLeave, setPendingLeave] = useState<string | null>(null);
  const cloudClient = useMemo(() => getMacCloudClient(), []);
  const cloudAuthCallbackError = useMacCloudAuthCallback(cloudClient);
  const cloudAccount = useCloudAccount(cloudClient);
  const signedIn = cloudAccount.kind === "signed-in";
  // A root uploaded by another account is edited locally only; syncing into
  // that account's Cloud copy would corrupt it.
  const cloudUserId = cloudAccount.kind === "signed-in" ? cloudAccount.user.id : null;
  const cloudMismatch = useCallback((root: TrackedRoot | null) => (
    Boolean(root?.cloudOwnerId && cloudUserId && root.cloudOwnerId !== cloudUserId)
  ), [cloudUserId]);
  const [shareOpen, setShareOpen] = useState(false);
  // The active note's Cloud ID, resolved from its root's index while the
  // Share sheet is open. Null until the note is in Cloud.
  const [shareItemId, setShareItemId] = useState<string | null>(null);
  const leaveRef = useRef<((path: string) => Promise<void>) | null>(null);
  // undefined while resolving; null when the home folder cannot be found.
  const [ghostFolderPath, setGhostFolderPath] = useState<string | null | undefined>(undefined);
  const signInSurface = useMemo<SignInSurfaceProps>(() => ({
    emailRedirectTo: MAC_CLOUD_AUTH_REDIRECT_URL,
    oauthRedirectTo: MAC_CLOUD_AUTH_REDIRECT_URL,
    openOAuthUrl: openMacCloudOAuthUrl,
    externalError: cloudAuthCallbackError,
    completeCallback: (url) => completeMacCloudAuthCallback(cloudClient, url),
  }), [cloudAuthCallbackError, cloudClient]);
  useEffect(() => {
    void ghostFolder().then(setGhostFolderPath).catch(() => setGhostFolderPath(null));
  }, []);
  const [activeFile, _setActiveFile] = useState<string | null>(null);
  const activeFileRef = useRef<string | null>(null);
  const backHistoryRef = useRef<string[]>([]);
  const forwardHistoryRef = useRef<string[]>([]);
  const recentCycleRef = useRef<{ paths: string[]; index: number } | null>(null);
  const openRequestRef = useRef(0);
  const openAbortRef = useRef<AbortController | null>(null);
  const setActiveFile = useCallback((path: string | null) => {
    activeFileRef.current = path;
    _setActiveFile(path);
    activeFileStore.set(path);
  }, [activeFileStore]);
  const [fileContent, setFileContent] = useState<string>("");
  const [fileDescriptor, setFileDescriptor] = useState<FileDescriptor | null>(null);
  const [sourceDocument, setSourceDocument] = useState<CodeMirrorText | null>(null);
  const [sourceProfile, setSourceProfile] = useState<SourceProfile | null>(null);
  const [sourceInspection, setSourceInspection] = useState<SourceInspection | null>(null);
  const [sourceLineSeparator, setSourceLineSeparator] = useState("\n");
  const [openPerformance, setOpenPerformance] = useState<FileOpenPerformanceTrace | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [activeDragName, setActiveDragName] = useState<string | null>(null);
  const [liveText, setLiveText] = useState("");
  const [forceStaticTextStats, setForceStaticTextStats] = useState(false);
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
  const fileVersionRef = useRef<FileVersionToken | null>(null);
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
  const sourceProfileRef = useRef<SourceProfile | null>(sourceProfile);
  sourceProfileRef.current = sourceProfile;
  const sourceInspectionRef = useRef<SourceInspection | null>(sourceInspection);
  sourceInspectionRef.current = sourceInspection;
  const styleBarRef = useRef(settings.showStyleBar);
  styleBarRef.current = settings.showStyleBar;
  const {
    recentFiles,
    addRecentFile,
    retargetRecentFiles,
    removeRecentFiles,
  } = useRecentFiles();

  const documentSave = useDocumentSave({
    knownDiskContent: fileContentRef,
    knownDiskVersion: fileVersionRef,
    lastSaveTimestamp,
  });

  // Every document switch flushes through this one function. A later phase
  // extends it to the Yjs session of a mirrored document.
  const flushActiveDocument = useCallback(async () => {
    await mirrorFlushRef.current?.();
    await window.__ghostFlushEditorSave?.();
    await documentSave.flush();
  }, [documentSave.flush]);

  // Folders Ghost creates are Yjs-backed from birth; any other folder gets
  // there through Sync to Cloud. Both paths end here.
  const makeRootMirrored = useCallback(async (root: TrackedRoot): Promise<string> => {
    const outcome = await performSync(tauriMirrorFs, root);
    setRootKind(root.path, "mirrored", outcome.bookmark);
    return describeSyncOutcome(root, outcome);
  }, [setRootKind]);

  // Signing out pauses sync and touches no files.
  const handleSignOut = useCallback(async () => {
    if (!cloudClient) return;
    await flushActiveDocument().catch(() => undefined);
    const { error } = await cloudClient.auth.signOut();
    if (error) throw error;
  }, [cloudClient, flushActiveDocument]);

  const focusEditor = useCallback((placement: "preserve" | "start" | "end" = "preserve") => {
    requestAnimationFrame(() => {
      const tiptap = editorInstanceRef.current;
      if (tiptap && !tiptap.isDestroyed) {
        tiptap.commands.focus(placement === "preserve" ? null : placement);
        return;
      }
      const codeMirror = cmViewRef.current;
      if (codeMirror) {
        if (placement === "start") {
          codeMirror.dispatch({
            selection: { anchor: 0 },
            effects: EditorView.scrollIntoView(0, { y: "start" }),
          });
        }
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

  const {
    flatFiles: allFiles,
    getEntries,
    getError,
    expandFolder,
    insertEntry: insertTreeEntry,
    renameEntry: renameTreeEntry,
    refreshPath: refreshTreePath,
    isSkippedDir,
  } = useFileTree(folders, extensions, refreshTrigger, settings.showHiddenFiles);

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
    openAbortRef.current?.abort();
    const abortController = new AbortController();
    openAbortRef.current = abortController;
    const previousPath = activeFileRef.current;
    if (activeFileRef.current && activeFileRef.current !== path) {
      try {
        await flushActiveDocument();
      } catch {
        // Keep the current editor open; its save status explains the failure.
        return false;
      }
    }

    try {
      setShowSettings(false);
      closeSearch();

      const model = await tauriLocalDocumentSource.load(
        localDocumentRef(path),
        abortController.signal,
      );

      if (requestId !== openRequestRef.current) return false;

      // The main viewport is shared across viewer mounts. Without an explicit
      // reset, keyboard previewing carries the previous document's scroll
      // depth into the next file before its viewer has a chance to focus.
      if (previousPath !== path && mainElRef.current) {
        mainElRef.current.scrollTop = 0;
        mainElRef.current.scrollLeft = 0;
      }

      if (recordHistory && previousPath && previousPath !== path) {
        const back = backHistoryRef.current;
        if (back[back.length - 1] !== previousPath) back.push(previousPath);
        if (back.length > 100) back.splice(0, back.length - 100);
        forwardHistoryRef.current = [];
      }

      fileContentRef.current = model.content;
      fileVersionRef.current = model.version;
      setFileDescriptor(model.descriptor);
      setSourceDocument(model.sourceDocument);
      setSourceProfile(model.sourceProfile);
      setSourceInspection(model.sourceInspection);
      setSourceLineSeparator(model.lineSeparator);
      setOpenPerformance(model.openPerformance);
      setActiveFile(path);
      setFileContent(model.content);
      setLiveText(model.content);
      setForceStaticTextStats(false);
      addRecentFile(path);
      return true;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return false;
      console.error("Failed to read file:", err);
      return false;
    } finally {
      if (openAbortRef.current === abortController) openAbortRef.current = null;
    }
  }, [closeSearch, addRecentFile, setActiveFile, flushActiveDocument]);

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


  // Accessory windows and Rust menu handlers reach the same flush.
  useEffect(() => {
    window.__ghostFlushSave = flushActiveDocument;
    return () => {
      if (window.__ghostFlushSave === flushActiveDocument) delete window.__ghostFlushSave;
    };
  }, [flushActiveDocument]);

  const handleContentChange = useCallback(
    async (markdown: string) => {
      // A rename can rewrite companion asset references on disk. Wait for
      // that fresh snapshot before checking expectedContent or choosing the
      // destination path for this edit.
      await retargetPromiseRef.current;
      const path = activeFileRef.current;
      if (!path) return;
      setLiveText(markdown);
      await documentSave.save(localDocumentRef(path), markdown);
    },
    [documentSave.save]
  );

  const handleSourceChange = useCallback(
    async (snapshot: SourceDocumentSnapshot) => {
      await retargetPromiseRef.current;
      const path = activeFileRef.current;
      if (!path) return;
      // Saving walks the immutable CodeMirror tree in bounded chunks. Only
      // small, fully featured documents may be flattened for header stats.
      if (shouldTrackLiveTextStats(
        sourceProfileRef.current,
        sourceInspectionRef.current,
        snapshot.document.length,
      )) {
        setLiveText(snapshot.document.toString());
      } else {
        setForceStaticTextStats(true);
      }
      await documentSave.saveSource(localDocumentRef(path), snapshot);
    },
    [documentSave.saveSource],
  );

  const handleFsChange = useCallback(() => {
    setRefreshTrigger((k) => k + 1);
  }, []);

  useFileWatcher(folders, refreshTreePath);

  // A fresh install opens with the cursor in a real note rather than a
  // folder picker. An emptied sidebar is left empty on purpose.
  const seededFirstRun = useRef(false);
  useEffect(() => {
    if (loading || !firstRun || folders.length > 0 || seededFirstRun.current) return;
    seededFirstRun.current = true;
    void (async () => {
      try {
        const notes = await ensureNotesFolder();
        const root = addFolderByPath(notes.path);
        await makeRootMirrored(root).catch((error) => console.error("Failed to mirror Notes:", error));
        if (notes.welcome_path && await openFile(notes.welcome_path, false)) focusEditor("end");
      } catch (error) {
        console.error("Failed to prepare the Notes folder:", error);
      }
    })();
  }, [addFolderByPath, firstRun, focusEditor, folders.length, loading, makeRootMirrored, openFile]);

  const applyContentRef = useRef<((content: string) => boolean) | null>(null);
  applyContentRef.current = (content) =>
    applyContentInPlace(editorInstanceRef, cmViewRef, mainElRef, content);

  // Reload active file when the main window regains focus (picks up edits
  // from accessory windows). Applies external changes in place, no remount.
  useReloadOnFocus({
    getDocument: () => {
      // A mirrored document ingests external writes itself.
      if (mirroredActiveRef.current) return null;
      const path = activeFileRef.current;
      return isTextBackedFile(fileDescriptorRef.current) && path
        ? localDocumentRef(path)
        : null;
    },
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
    onVersionChanged: async (ref) => {
      const model = await tauriLocalDocumentSource.load(ref);
      if (activeFileRef.current !== ref.path) return true;

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
      setForceStaticTextStats(false);
      return true;
    },
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
      let nextSourceDocument: CodeMirrorText | null = null;
      let nextSourceProfile: SourceProfile | null = null;
      let nextSourceInspection: SourceInspection | null = null;
      let nextLineSeparator = "\n";
      try {
        const model = await tauriLocalDocumentSource.load(localDocumentRef(renamedPath));
        content = model.content;
        descriptor = model.descriptor;
        fileVersionRef.current = model.version;
        nextSourceDocument = model.sourceDocument;
        nextSourceProfile = model.sourceProfile;
        nextSourceInspection = model.sourceInspection;
        nextLineSeparator = model.lineSeparator;
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
      setForceStaticTextStats(false);
      setFileDescriptor(descriptor);
      setSourceDocument(nextSourceDocument);
      setSourceProfile(nextSourceProfile);
      setSourceInspection(nextSourceInspection);
      setSourceLineSeparator(nextLineSeparator);
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

  // A synced note Ghost renamed or moved keeps its document: the index entry
  // follows before the editor remounts, so nothing is adopted twice or
  // trashed in Cloud. Queued with reconciliation.
  const relocateMirrored = useCallback(async (oldPath: string, newPath: string) => {
    const root = rootForPath(rootsForResolution.current, oldPath);
    if (!root || root.kind !== "mirrored" || root.shared || !insideRoot(root, newPath) || newPath === root.path) return;
    const from = relativeToRoot(root.path, oldPath);
    const to = relativeToRoot(root.path, newPath);
    if (!from || !to) return;
    const run = rootSyncChain.current.then(() => relocateDocument({
      fs: tauriMirrorFs,
      client: signedIn && cloudClient && !cloudMismatch(root) ? cloudClient : null,
      openPersistence: (id, documentId, document) => openYjsPersistence(mirrorLocalPersistenceKey(id, documentId), document),
    }, root, from, to));
    rootSyncChain.current = run.catch(() => undefined);
    await run.catch((error: unknown) => console.error("Failed to move a synced note's document:", error));
  }, [cloudClient, cloudMismatch, signedIn]);

  const handleFileRenamed = useCallback(
    async (oldPath: string, newPath: string) => {
      renameTreeEntry(oldPath, newPath);
      refreshTreePath(newPath);
      await relocateMirrored(oldPath, newPath);
      await retargetActiveFile(oldPath, newPath);
      // Notify accessory windows
      invoke("emit_file_renamed", { oldPath, newPath }).catch(() => {});
    },
    [relocateMirrored, renameTreeEntry, refreshTreePath, retargetActiveFile]
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
        setSourceDocument(null);
        setSourceProfile(null);
        setSourceInspection(null);
        setFileContent("");
        setForceStaticTextStats(false);
        fileVersionRef.current = null;
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
        await flushActiveDocument();
        const newPath = await invoke<string>("move_file", { filePath, targetDir: folderPath });
        await relocateMirrored(filePath, newPath);
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
    [relocateMirrored, retargetActiveFile, handleFsChange, flushActiveDocument]
  );

  // With nothing to aim at, new items go to Notes, creating it on demand.
  const ensureNotesRoot = useCallback(async (): Promise<string> => {
    const notes = await ensureNotesFolder();
    const root = addFolderByPath(notes.path);
    if (root.kind !== "mirrored") {
      await makeRootMirrored(root).catch((error) => console.error("Failed to mirror Notes:", error));
    }
    return notes.path;
  }, [addFolderByPath, makeRootMirrored]);

  const resolveTargetDirectory = useCallback(async (targetDirectory?: string): Promise<string> => {
    // Nothing is created inside Shared: it mirrors other people's notes, and
    // a stray file there would be swept away on the next refresh.
    const shared = rootsForResolution.current.find((root) => root.shared) ?? null;
    const usable = (dir: string | null | undefined): dir is string => Boolean(dir) && !insideRoot(shared, dir);
    if (usable(targetDirectory)) return targetDirectory;
    const keyboardTarget = treeKeyboardRef.current?.hasFocus()
      ? treeKeyboardRef.current.getTargetDirectory()
      : null;
    if (usable(keyboardTarget)) return keyboardTarget;
    const currentFile = activeFileRef.current;
    const currentDir = currentFile ? currentFile.substring(0, currentFile.lastIndexOf("/")) : null;
    if (usable(currentDir)) return currentDir;
    return ensureNotesRoot();
  }, [ensureNotesRoot]);

  // Expose functions for Rust menu events
  const createNewFile = useCallback(async (targetDirectory?: string) => {
    let targetDir: string;
    try {
      targetDir = await resolveTargetDirectory(targetDirectory);
    } catch (error) {
      console.error("Failed to choose a folder for the new file:", error);
      return;
    }
    let name = "Untitled.md";
    let counter = 1;
    while (true) {
      try {
        const path = await invoke<string>("create_file", { dir: targetDir, name });
        setNewlyCreatedFile(path);
        insertTreeEntry(path, false);
        refreshTreePath(path);
        handleFileSelect(path);
        break;
      } catch {
        counter++;
        name = `Untitled ${counter}.md`;
        if (counter > 100) break;
      }
    }
  }, [resolveTargetDirectory, handleFileSelect, insertTreeEntry, refreshTreePath]);

  const createNewFolder = useCallback(async (targetDirectory?: string) => {
    let targetDir: string;
    try {
      targetDir = await resolveTargetDirectory(targetDirectory);
    } catch (error) {
      console.error("Failed to choose a folder for the new folder:", error);
      return;
    }

    let name = "New Folder";
    let counter = 1;
    while (counter < 100) {
      try {
        const path = await invoke<string>("create_directory", {
          parent: targetDir,
          name,
        });
        setNewlyCreatedFolder(path);
        insertTreeEntry(path, true);
        refreshTreePath(path);
        break;
      } catch {
        counter += 1;
        name = `New Folder ${counter}`;
      }
    }
  }, [resolveTargetDirectory, insertTreeEntry, refreshTreePath]);

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

  const activeRoot = useMemo(() => (activeFile ? rootForPath(roots, activeFile) : null), [activeFile, roots]);
  const mirroredActive = activeRoot?.kind === "mirrored" && fileDescriptor?.kind === "markdown";
  mirroredActiveRef.current = mirroredActive;

  useEffect(() => {
    if (!shareOpen || !activeFile || !activeRoot || activeRoot.kind !== "mirrored") {
      setShareItemId(null);
      return;
    }
    let cancelled = false;
    const relativePath = relativeToRoot(activeRoot.path, activeFile);
    void readGhostFolder(tauriMirrorFs, activeRoot.path).then(({ metadata, index }) => {
      if (cancelled) return;
      const entry = relativePath ? index.documents[relativePath] : undefined;
      const uploaded = activeRoot.cloudRootId ?? metadata?.cloudRootId ?? null;
      setShareItemId(entry ? (entry.cloudDocumentId ?? (uploaded ? entry.documentId : null)) : null);
    }).catch(() => { if (!cancelled) setShareItemId(null); });
    return () => { cancelled = true; };
  }, [activeFile, activeRoot, shareOpen]);

  const folderNameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1) || path;

  // Sidebar sections appear once an account makes "Cloud" true.
  const sections = useMemo(() => {
    if (!signedIn) return [{ id: "all", label: null as string | null, roots }];
    return [
      { id: "cloud", label: "Cloud" as string | null, roots: roots.filter((root) => root.kind === "mirrored") },
      { id: "mac", label: "On This Mac" as string | null, roots: roots.filter((root) => root.kind === "plain") },
    ];
  }, [roots, signedIn]);
  const displayOrder = useMemo(() => sections.flatMap((section) => section.roots), [sections]);
  const reorderDisplayed = useCallback((from: number, to: number) => {
    const next = [...displayOrder];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    if (signedIn) {
      // A drag never crosses sections.
      const firstPlain = next.findIndex((root) => root.kind === "plain");
      if (firstPlain !== -1 && next.slice(firstPlain).some((root) => root.kind === "mirrored")) return;
    }
    setRootOrder(next.map((root) => root.id));
  }, [displayOrder, setRootOrder, signedIn]);

  const handleSyncConfirm = useCallback(async (path: string) => {
    try {
      await flushActiveDocument();
      const root = roots.find((candidate) => candidate.path === path) ?? addFolderByPath(path);
      setMirrorNotification(await makeRootMirrored(root));
    } catch (error) {
      setMirrorNotification(error instanceof Error ? error.message : String(error));
    } finally {
      setSyncDialogPath(null);
    }
  }, [addFolderByPath, flushActiveDocument, makeRootMirrored, roots]);

  const handleStopSyncingConfirm = useCallback(async (root: TrackedRoot) => {
    try {
      await flushActiveDocument().catch(() => undefined);
      // The open note's model belongs to the mirror; a plain editor would
      // show what was loaded at open time. Close it and let it reopen.
      if (insideRoot(root, activeFileRef.current)) {
        setActiveFile(null);
        setFileDescriptor(null);
        setFileContent("");
      }
      if (root.cloudRootId && signedIn && cloudClient && !cloudMismatch(root)) {
        await trashCloudItem(cloudClient, root.cloudRootId).catch((error: unknown) => {
          console.warn("The Cloud copy was not moved to Trash:", error);
        });
      }
      await stopSyncing(tauriMirrorFs, root);
      uploadingRoots.current.delete(root.id);
      failedUploads.current.delete(root.id);
      setRootKind(root.path, "plain");
      updateRoot(root.id, { cloudRootId: undefined, cloudOwnerId: undefined });
      setRootResolutions((current) => {
        if (!current[root.id]) return current;
        const next = { ...current };
        delete next[root.id];
        return next;
      });
      setMirrorNotification(`${folderNameOf(root.path)} stays on this Mac as plain Markdown.`);
    } catch (error) {
      setMirrorNotification(error instanceof Error ? error.message : String(error));
    } finally {
      setStopSyncingRoot(null);
    }
  }, [cloudClient, cloudMismatch, flushActiveDocument, setActiveFile, setRootKind, signedIn, updateRoot]);

  const handleLinkIntoProject = useCallback(async (rootPath: string) => {
    const root = roots.find((candidate) => candidate.path === rootPath);
    if (!root) return;
    const repository = await openFolderDialog({ directory: true, multiple: false, title: "Choose a repository" });
    if (!repository || typeof repository !== "string") return;
    try {
      const link = await linkIntoRepository(tauriMirrorFs, root, repository);
      setMirrorNotification(link.linkCreated
        ? `Linked ${folderNameOf(root.path)} as notes inside ${folderNameOf(repository)}. Git ignores it through .git/info/exclude.`
        : `${folderNameOf(repository)} already links to ${folderNameOf(root.path)}.`);
    } catch (error) {
      setMirrorNotification(error instanceof Error ? error.message : String(error));
    }
  }, [roots]);

  const handleCopyToNotes = useCallback(async (filePath: string) => {
    try {
      await flushActiveDocument();
      const notes = await ensureNotesRoot();
      const copied = await tauriMirrorFs.copyFileInto(filePath, notes);
      insertTreeEntry(copied, false);
      refreshTreePath(copied);
      setMirrorNotification(`Copied ${folderNameOf(filePath)} to Notes.`);
    } catch (error) {
      setMirrorNotification(error instanceof Error ? error.message : String(error));
    }
  }, [ensureNotesRoot, flushActiveDocument, insertTreeEntry, refreshTreePath]);

  const handleSaveCopy = useCallback(async (filePath: string) => {
    const target = await openFolderDialog({ directory: true, multiple: false, title: "Save a copy in…" });
    if (!target || typeof target !== "string") return;
    try {
      await flushActiveDocument();
      const copied = await tauriMirrorFs.copyFileInto(filePath, target);
      refreshTreePath(copied);
      setMirrorNotification(`Saved a copy of ${folderNameOf(filePath)} in ${folderNameOf(target)}.`);
    } catch (error) {
      setMirrorNotification(error instanceof Error ? error.message : String(error));
    }
  }, [flushActiveDocument, refreshTreePath]);

  const sidebarActions = useMemo<SidebarActions>(() => ({
    rootKindOf: (path) => roots.find((root) => root.path === path)?.kind ?? null,
    isSharedRoot: (path) => roots.some((root) => root.shared && root.path === path),
    leave: (path) => setPendingLeave(path),
    syncFolder: (path) => setSyncDialogPath(path),
    stopSyncing: (rootPath) => {
      const root = roots.find((candidate) => candidate.path === rootPath);
      if (root) setStopSyncingRoot(root);
    },
    linkIntoProject: (rootPath) => { void handleLinkIntoProject(rootPath); },
    copyToNotes: (filePath) => { void handleCopyToNotes(filePath); },
    saveCopy: (filePath) => { void handleSaveCopy(filePath); },
  }), [handleCopyToNotes, handleLinkIntoProject, handleSaveCopy, roots]);

  // Folders under ~/Ghost are Ghost's. Adopt any that predate the mirror
  // engine, so an upgrade needs nothing from the user.
  const migratedGhostRoots = useRef(false);
  useEffect(() => {
    if (loading || migratedGhostRoots.current) return;
    migratedGhostRoots.current = true;
    void (async () => {
      const ghost = await ghostFolder().catch(() => null);
      if (!ghost) return;
      for (const root of roots) {
        if (root.kind !== "plain" || !root.path.startsWith(`${ghost}/`)) continue;
        try {
          await makeRootMirrored(root);
        } catch (error) {
          console.error("Failed to mirror a Ghost folder:", error);
        }
      }
    })();
  }, [loading, makeRootMirrored, roots]);

  // Resolve every mirrored root's bookmark on launch and on focus. A moved
  // folder is followed silently; anything else becomes a notice row, and a
  // missing folder never deletes anything.
  const resolutionFs = useMemo<RootResolutionFs>(() => ({
    resolveBookmark: (bookmark) => tauriMirrorFs.resolveBookmark(bookmark),
    isDirectory: (path) => tauriMirrorFs.isDirectory(path),
    inspect: async (path) => {
      const facts = await tauriMirrorFs.inspectSyncCandidate(path, { deep: false });
      return { ancestorVcs: facts.ancestorVcs, ancestorManaged: facts.ancestorManaged, syncService: facts.syncService };
    },
    mountedVolumes: () => tauriMirrorFs.mountedVolumes(),
  }), []);
  const rootsForResolution = useRef(roots);
  rootsForResolution.current = roots;
  const lastResolveAt = useRef(0);
  const resolveRoots = useCallback(async (force = false) => {
    if (!force && Date.now() - lastResolveAt.current < 5_000) return;
    lastResolveAt.current = Date.now();
    for (const root of rootsForResolution.current) {
      if (root.kind !== "mirrored") continue;
      try {
        const resolution = await resolveMirroredRoot(root, resolutionFs);
        if (resolution.kind === "ok") {
          if (resolution.moved || resolution.bookmarkStale) {
            const bookmark = await tauriMirrorFs.createBookmark(resolution.path).catch(() => undefined);
            if (resolution.moved) retargetNavigationHistory(root.path, resolution.path);
            updateRootPath(root.id, resolution.path, bookmark);
          }
          setRootResolutions((current) => {
            if (!current[root.id]) return current;
            const next = { ...current };
            delete next[root.id];
            return next;
          });
        } else {
          setRootResolutions((current) => ({ ...current, [root.id]: resolution }));
        }
      } catch (error) {
        console.error("Failed to resolve a synced folder:", error);
      }
    }
  }, [resolutionFs, retargetNavigationHistory, updateRootPath]);
  useEffect(() => {
    if (loading) return;
    void resolveRoots(true);
    const onFocus = () => { void resolveRoots(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [loading, resolveRoots]);

  // Keep each mirrored root's index and Cloud tree in step with the files on
  // disk: deletions, renames, moves, and new files, from any app. Runs on
  // launch, after every watcher event below a root, and after an upload.
  const rootSyncTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const rootSyncChain = useRef<Promise<unknown>>(Promise.resolve());
  const reconcileRoot = useCallback((rootId: string) => {
    const timers = rootSyncTimers.current;
    const pending = timers.get(rootId);
    if (pending) clearTimeout(pending);
    timers.set(rootId, setTimeout(() => {
      timers.delete(rootId);
      rootSyncChain.current = rootSyncChain.current.then(async () => {
        const root = rootsForResolution.current.find((candidate) => candidate.id === rootId);
        if (!root || root.kind !== "mirrored" || root.shared) return;
        if (uploadingRoots.current.has(rootId)) return;
        const resolution = rootResolutionsRef.current[rootId];
        if (resolution && resolution.kind !== "ok") return;
        const result = await reconcileMirroredRoot({
          fs: tauriMirrorFs,
          client: signedIn && cloudClient && !cloudMismatch(root) ? cloudClient : null,
          openPersistence: (id, documentId, document) => (
            openYjsPersistence(mirrorLocalPersistenceKey(id, documentId), document)
          ),
          isOpen: (path) => activeFileRef.current === path,
        }, root);
        if (result.added.length || result.removed.length || result.renamed.length) handleFsChange();
      }).catch((error: unknown) => {
        console.error("Failed to reconcile a synced folder:", error);
      });
    }, 700));
  }, [cloudClient, cloudMismatch, handleFsChange, signedIn]);
  // Ids and paths: a root that moved is reconciled again at its new place.
  const mirroredRootKey = JSON.stringify(
    roots.filter((root) => root.kind === "mirrored" && !root.shared).map((root) => [root.id, root.path]),
  );
  useEffect(() => {
    if (loading) return;
    for (const [id] of JSON.parse(mirroredRootKey) as Array<[string, string]>) reconcileRoot(id);
    const unlisten = listen<FsEvent>("fs-event", (event) => {
      const { path, from } = event.payload;
      for (const root of rootsForResolution.current) {
        if (root.kind !== "mirrored" || root.shared) continue;
        const inside = (candidate: string | null) => candidate !== null
          && candidate.startsWith(`${root.path}/`)
          && !candidate.includes("/.ghost/");
        if (inside(path) || inside(from)) reconcileRoot(root.id);
      }
    });
    return () => { void unlisten.then((stop) => stop()); };
  }, [loading, mirroredRootKey, reconcileRoot]);

  // Signing in uploads every mirrored root that has never been sent. Each
  // root remembers its Cloud ID, so running again sends nothing twice.
  useEffect(() => {
    failedUploads.current.clear();
  }, [cloudUserId]);
  useEffect(() => {
    if (!signedIn || !cloudClient || !cloudUserId || loading || ghostFolderPath === undefined) return;
    const client = cloudClient;
    const ghost = ghostFolderPath;
    const userId = cloudUserId;
    const openPersistence = (rootId: string, documentId: string, document: Y.Doc) => (
      openYjsPersistence(mirrorLocalPersistenceKey(rootId, documentId), document)
    );
    // Same queue as reconciliation and pulls, so nothing else rewrites the
    // index while the upload records folder and document IDs.
    const run = rootSyncChain.current.then(async () => {
      for (const root of rootsForResolution.current) {
        if (root.kind !== "mirrored" || root.shared) continue;
        if (uploadingRoots.current.has(root.id) || failedUploads.current.has(root.id)) continue;
        if (root.cloudRootId) {
          if (!root.cloudOwnerId) {
            // Uploaded before the owner was recorded: it was this account.
            updateRoot(root.id, { cloudOwnerId: userId });
          } else if (root.cloudOwnerId !== userId) {
            failedUploads.current.add(root.id);
            setMirrorNotification(
              `${folderNameOf(root.path)} is in Cloud under another account. It stays local until you sign in as that account, or stop and restart syncing.`,
            );
          }
          continue;
        }
        uploadingRoots.current.add(root.id);
        try {
          const result = await uploadMirroredRoot({ client, fs: tauriMirrorFs, ghostFolder: ghost, openPersistence }, root);
          updateRoot(root.id, { cloudRootId: result.cloudRootId, cloudOwnerId: userId });
          if (!result.alreadyUploaded) setMirrorNotification(`${folderNameOf(root.path)} is in Cloud.`);
        } catch (error) {
          failedUploads.current.add(root.id);
          setMirrorNotification(isMissingServerFunction(error)
            ? "Cloud needs a server update before folders can upload."
            : `Could not upload ${folderNameOf(root.path)}: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
          uploadingRoots.current.delete(root.id);
        }
        reconcileRoot(root.id);
      }
    });
    rootSyncChain.current = run.catch(() => undefined);
  }, [cloudClient, cloudUserId, ghostFolderPath, loading, reconcileRoot, roots, signedIn, updateRoot]);

  // Cloud to this Mac. What other people shared lands in ~/Ghost/Shared, and
  // closed documents in every uploaded root pick up changes made elsewhere.
  // Runs at sign-in, on focus, and every few minutes; an open document has
  // its own live session and is left alone.
  const refreshingCloud = useRef<Promise<void> | null>(null);
  const lastCloudRefresh = useRef(0);
  const refreshCloud = useCallback((force = false): Promise<void> => {
    if (!signedIn || !cloudClient || loading || ghostFolderPath === undefined) return Promise.resolve();
    if (refreshingCloud.current) return refreshingCloud.current;
    if (!force && Date.now() - lastCloudRefresh.current < CLOUD_REFRESH_MIN_MS) return Promise.resolve();
    const client = cloudClient;
    const ghost = ghostFolderPath;
    const isOpen = (path: string) => activeFileRef.current === path;
    const openPersistence = (rootId: string, documentId: string, document: Y.Doc) => (
      openYjsPersistence(mirrorLocalPersistenceKey(rootId, documentId), document)
    );
    // Same queue as root reconciliation, so a pull never races a delete.
    const run = rootSyncChain.current.then(async () => {
      let changed = false;
      try {
        await acceptCloudInvitations(client).catch((error) => {
          if (!isMissingSharingFunction(error)) throw error;
        });
        let visible;
        try {
          visible = await listVisibleCloudItems(client);
        } catch (error) {
          if (isMissingSharingFunction(error)) return;
          throw error;
        }
        const existingShared = rootsForResolution.current.find((root) => root.shared) ?? null;
        const anyShared = visible.some((item) => item.shared_root_id !== null);
        if (ghost && (anyShared || existingShared)) {
          const sharedPath = `${ghost}/${SHARED_FOLDER_NAME}`;
          await tauriMirrorFs.ensureDir(sharedPath);
          const sharedRoot = existingShared ?? ensureSharedRoot(sharedPath);
          const result = await refreshSharedRoot({ fs: tauriMirrorFs, client, openPersistence, isOpen }, sharedRoot, visible);
          if (result.added.length || result.removed.length || result.moved.length || result.pull.written.length) changed = true;
          if (result.added.length === 1) setMirrorNotification(`${folderNameOf(result.added[0])} was shared with you.`);
          else if (result.added.length > 1) setMirrorNotification(`${result.added.length} notes were shared with you.`);
          // The root goes when nothing is shared, unless a note in it is still open.
          if (result.empty && existingShared && !insideRoot(sharedRoot, activeFileRef.current)) removeFolder(sharedRoot.path);
        }
        for (const root of rootsForResolution.current) {
          if (root.kind !== "mirrored" || root.shared || !root.cloudRootId || cloudMismatch(root)) continue;
          if (uploadingRoots.current.has(root.id)) continue;
          const resolution = rootResolutionsRef.current[root.id];
          if (resolution && resolution.kind !== "ok") continue;
          const pulled = await pullCloudChanges({ fs: tauriMirrorFs, client, openPersistence, isOpen }, root);
          if (pulled.written.length > 0) changed = true;
        }
      } catch (error) {
        console.warn("Cloud refresh failed:", error);
      } finally {
        lastCloudRefresh.current = Date.now();
        refreshingCloud.current = null;
        if (changed) handleFsChange();
      }
    });
    rootSyncChain.current = run.catch(() => undefined);
    refreshingCloud.current = run;
    return run;
  }, [cloudClient, cloudMismatch, ensureSharedRoot, ghostFolderPath, handleFsChange, loading, removeFolder, signedIn]);

  useEffect(() => {
    if (!signedIn) return;
    void refreshCloud(true);
    const onFocus = () => { void refreshCloud(); };
    window.addEventListener("focus", onFocus);
    const timer = setInterval(() => { void refreshCloud(true); }, CLOUD_REFRESH_INTERVAL_MS);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(timer);
    };
  }, [refreshCloud, signedIn]);

  // Leave something shared with you: the Cloud membership goes, and the
  // next refresh moves the local file to the Trash.
  const handleLeave = useCallback(async (path: string) => {
    const client = cloudClient;
    const sharedRoot = rootsForResolution.current.find((root) => root.shared) ?? null;
    if (!client || !sharedRoot) return;
    const relativePath = relativeToRoot(sharedRoot.path, path);
    if (!relativePath) return;
    try {
      const { index } = await readGhostFolder(tauriMirrorFs, sharedRoot.path);
      const itemId = index.documents[relativePath]?.documentId ?? index.folders[relativePath];
      if (!itemId) throw new Error("This item is not shared with you.");
      const active = activeFileRef.current;
      if (active && (active === path || active.startsWith(`${path}/`))) {
        await flushActiveDocument().catch(() => undefined);
        setActiveFile(null);
      }
      await leaveCloudItem(client, itemId);
      setMirrorNotification(`You left ${folderNameOf(path)}.`);
      await refreshCloud(true);
    } catch (error) {
      setMirrorNotification(error instanceof Error ? error.message : String(error));
    }
  }, [cloudClient, flushActiveDocument, refreshCloud]);
  leaveRef.current = handleLeave;

  const handleLocateRoot = useCallback(async (root: TrackedRoot) => {
    const chosen = await openFolderDialog({
      directory: true,
      multiple: false,
      title: `Locate ${folderNameOf(root.path)}`,
    });
    if (!chosen || typeof chosen !== "string") return;
    const { metadata } = await readGhostFolder(tauriMirrorFs, chosen);
    if (metadata?.rootId !== root.id) {
      setMirrorNotification(
        `That folder isn't ${folderNameOf(root.path)}. Ghost looks for the folder's own .ghost metadata.`,
      );
      return;
    }
    const bookmark = await tauriMirrorFs.createBookmark(chosen).catch(() => undefined);
    retargetNavigationHistory(root.path, chosen);
    updateRootPath(root.id, chosen, bookmark);
    setRootResolutions((current) => {
      const next = { ...current };
      delete next[root.id];
      return next;
    });
    handleFsChange();
  }, [handleFsChange, retargetNavigationHistory, updateRootPath]);

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
    if (!willExpand) focusEditor();
  }, [focusEditor, sidebarCollapsed, sidebarWidth]);

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
      await flushActiveDocument();
      const newPath = await invoke<string>("move_file", {
        filePath: pendingMove.filePath,
        targetDir: pendingMove.targetDir,
        force: true,
      });
      await relocateMirrored(pendingMove.filePath, newPath);
      await retargetActiveFile(pendingMove.filePath, newPath);
      handleFsChange();
      setPendingMove(null);
    } catch (err) {
      console.error("Failed to override:", err);
    }
  }, [pendingMove, relocateMirrored, retargetActiveFile, handleFsChange, flushActiveDocument]);

  const handleHeaderRename = useCallback(async (nextName: string) => {
    if (!activeFile || nextName === breadcrumb?.fileName) return;
    await flushActiveDocument();
    const newPath = await invoke<string>("rename_file", {
      oldPath: activeFile,
      newName: nextName,
    });
    await handleFileRenamed(activeFile, newPath);
  }, [activeFile, breadcrumb?.fileName, handleFileRenamed, flushActiveDocument]);

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
      id: "workspace.openFolder",
      title: "Open Folder…",
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                data-sidebar-chrome
                className="text-ring hover:text-sidebar-foreground transition-colors cursor-pointer"
                title="New…"
                aria-label="New file, folder, or open a folder"
              >
                <Plus className="size-[15px]" strokeWidth={2.25} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onSelect={() => { void createNewFile(); }}>
                New File
                <DropdownMenuShortcut>⌘N</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => { void createNewFolder(); }}>
                New Folder
                <DropdownMenuShortcut>⇧⌘N</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => { void addFolder(); }}>
                Open Folder…
                <DropdownMenuShortcut>⌘O</DropdownMenuShortcut>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
          <SidebarActionsProvider value={sidebarActions}>
          <DndContext
            sensors={sensors}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
          >
            {loading || (folders.length === 0 && firstRun) ? null : folders.length === 0 ? (
              <EmptyState
                onNewFile={() => { void createNewFile(); }}
                onOpenFolder={() => { void addFolder(); }}
              />
            ) : (
              <div className="pt-1">
                {sections.map((section) => (
                  <div key={section.id} data-sidebar-section={section.id}>
                    {section.label ? <SidebarSectionHeader label={section.label} /> : null}
                    {section.roots.length === 0 ? (
                      section.id === "cloud" ? (
                        <SidebarMutedRow>Nothing in Cloud yet. Sync a folder, or press ⌘N.</SidebarMutedRow>
                      ) : (
                        <SidebarMutedRow onClick={() => { void addFolder(); }} title="Open a folder (⌘O)">
                          Open a folder…
                        </SidebarMutedRow>
                      )
                    ) : null}
                    {section.roots.map((root) => (root.kind === "mirrored"
                      && rootResolutions[root.id]
                      && rootResolutions[root.id].kind !== "ok" ? (
                      <div key={root.id} data-root-folder={root.path}>
                        <MirroredRootNotice
                          resolution={rootResolutions[root.id] as Exclude<RootResolution, { kind: "ok" }>}
                          onLocate={() => { void handleLocateRoot(root); }}
                          onStopSyncing={() => setStopSyncingRoot(root)}
                        />
                      </div>
                    ) : (
                  <FolderTree
                    key={root.path}
                    path={root.path}
                    folderIndex={displayOrder.indexOf(root)}
                    folderCount={displayOrder.length}
                    onReorderProject={reorderDisplayed}
                    entries={getEntries(root.path)}
                    error={getError(root.path)}
                    onRefreshFolder={handleFsChange}
                    onFileSelect={handleFileSelect}
                    onRemoveFolder={async (path) => {
                      try {
                        await flushActiveDocument();
                      } catch {
                        return;
                      }
                      removeFromNavigationHistory(path);
                      removeFolder(path);
                      if (activeFile === path || activeFile?.startsWith(`${path}/`)) {
                        setActiveFile(null);
                        setFileDescriptor(null);
                        setFileContent("");
                      }
                    }}
                    onRootRenamed={handleRootRenamed}
                    onFileRenamed={handleFileRenamed}
                    onFileDeleted={handleFileDeleted}
                    newlyCreatedFile={newlyCreatedFile}
                    onNewFileCreated={(path) => {
                      setNewlyCreatedFile(path);
                      insertTreeEntry(path, false);
                      refreshTreePath(path);
                    }}
                    onNewFileRenamed={() => setNewlyCreatedFile(null)}
                    newlyCreatedFolder={newlyCreatedFolder}
                    onNewFolderCreated={(path) => {
                      setNewlyCreatedFolder(path);
                      insertTreeEntry(path, true);
                      refreshTreePath(path);
                    }}
                    onNewFolderRenamed={() => setNewlyCreatedFolder(null)}
                    activeDropFolder={activeDropFolder}
                    onAddProject={addFolder}
                    defaultOpen={isFolderOpen(root.path)}
                    onRootOpenChange={setFolderOpen}
                    onExpandFolder={expandFolder}
                    isSkippedDir={isSkippedDir}
                  />
                    )))}
                  </div>
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
          </SidebarActionsProvider>
          </ActiveFileProvider>
        </FileTreeKeyboard>
        <SidebarGuide treeAreaRef={treeAreaRef} />
        </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-56" onCloseAutoFocus={(e) => e.preventDefault()}>
          <ContextMenuItem onSelect={() => { void createNewFile(); }}>
            New File
            <ContextMenuShortcut>⌘N</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => { void createNewFolder(); }}>
            New Folder
            <ContextMenuShortcut>⇧⌘N</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => { void addFolder(); }}>
            Open Folder…
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
        {(
          <DocumentHeader
            pathSegments={breadcrumb?.folderName ? [breadcrumb.folderName] : []}
            fileName={breadcrumb?.fileName ?? null}
            onRename={activeFile ? handleHeaderRename : undefined}
            sidebarCollapsed={sidebarCollapsed}
            search={search.searchOpen ? (
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
            ) : undefined}
            right={activeFile ? (
              <>
                {fileDescriptor?.kind === "markdown" ? (
                  <button
                    type="button"
                    data-share-button
                    className="cursor-pointer text-[11px] text-ring transition-colors hover:text-sidebar-foreground"
                    title="Share this note"
                    onClick={() => setShareOpen(true)}
                  >
                    Share
                  </button>
                ) : null}
                {mirroredActive ? (
                <MirrorSaveStatus status={mirrorStatus.status} error={mirrorStatus.error} />
              ) : fileDescriptor?.editable ? (
                <>
                  <SaveStatus
                    status={documentSave.status}
                    error={documentSave.error}
                    onRetry={documentSave.retry}
                  />
                  {fileDescriptor.showTextStats ? (
                    <TextStats
                      text={liveText}
                      countMode={settings.countMode}
                      onCountModeChange={(countMode) => updateSettings({ countMode })}
                      sourceInspection={sourceInspection}
                      forceStatic={forceStaticTextStats}
                    />
                  ) : null}
                </>
              ) : fileDescriptor?.canOpenExternally ? (
                <OpenExternalButton filePath={activeFile} />
              ) : null}
              </>
            ) : null}
          />
        )}

        {/* Editor — scrolls behind the floating header */}
        <main
          ref={setMainEl}
          data-editor-scroll-container={true}
          tabIndex={-1}
          onFocus={(event) => {
            if (event.target === event.currentTarget) focusViewerTarget(event.currentTarget);
          }}
          className="h-full overscroll-contain relative outline-none overflow-auto"
        >
          {mirroredActive && activeFile && activeRoot ? (
            <MirroredDocumentEditor
              key={activeFile}
              path={activeFile}
              root={activeRoot}
              showStyleBar={settings.showStyleBar}
              onToggleStyleBar={() => updateSettings({ showStyleBar: !settings.showStyleBar })}
              onEditorReady={setEditorInstance}
              platformActions={tauriMarkdownEditorActions}
              onStatusChange={(status, error) => setMirrorStatus({ status, error })}
              onNotify={setMirrorNotification}
              registerFlush={(flush) => { mirrorFlushRef.current = flush; }}
              cloud={cloudClient && cloudAccount.kind === "signed-in" && !cloudMismatch(activeRoot)
                ? { client: cloudClient, user: cloudAccount.user }
                : null}
            />
          ) : activeFile && fileDescriptor ? (
            <FileViewer
              filePath={activeFile}
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
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="text-muted-foreground/40 text-sm">
                Select a note or file to start editing
              </p>
            </div>
          )}
        </main>
        <AppNotification message={mirrorNotification} onDismiss={() => setMirrorNotification(null)} />
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

      <SyncFolderDialog
        path={syncDialogPath}
        roots={roots}
        onClose={() => setSyncDialogPath(null)}
        onConfirm={handleSyncConfirm}
      />
      <StopSyncingDialog
        root={stopSyncingRoot}
        onClose={() => setStopSyncingRoot(null)}
        onConfirm={handleStopSyncingConfirm}
      />
      <SidebarTrashDialog
        open={pendingLeave !== null}
        kind="file"
        name={pendingLeave ? folderNameOf(pendingLeave) : ""}
        title={pendingLeave ? `Leave “${folderNameOf(pendingLeave)}”?` : ""}
        description="You will no longer see it here or on your phone. The owner keeps it and can share it again."
        confirmLabel="Leave"
        onOpenChange={(open) => { if (!open) setPendingLeave(null); }}
        onConfirm={() => {
          const path = pendingLeave;
          setPendingLeave(null);
          if (path) void leaveRef.current?.(path);
        }}
      />
      <ShareSheet
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        client={cloudClient}
        account={cloudAccount}
        filePath={activeFile}
        root={activeRoot}
        cloudItemId={shareItemId}
        signIn={signInSurface}
        onSyncFolder={(path) => setSyncDialogPath(path)}
        onCopyToNotes={(filePath) => { void handleCopyToNotes(filePath); }}
      />

      {showSettings && (
        <SettingsPage
          settings={settings}
          onUpdateSettings={updateSettings}
          onClose={() => setShowSettings(false)}
          customThemes={settings.customThemes}
          onSaveTheme={saveTheme}
          onDeleteTheme={deleteTheme}
          updater={updater}
          account={{
            client: cloudClient,
            account: cloudAccount,
            signIn: signInSurface,
            onSignOut: handleSignOut,
            ghostFolderPath: ghostFolderPath ?? null,
          }}
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
