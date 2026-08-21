import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type FocusEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";

export type FileTreeAction =
  | "activate"
  | "preview"
  | "openNewWindow"
  | "rename"
  | "duplicate"
  | "trash"
  | "copyPath"
  | "reveal"
  | "newFile"
  | "newFolder"
  | "closeProject";

type TreeActionHandler = () => void | Promise<void>;

interface FileTreeNodeSpec {
  path: string;
  label: string;
  kind: "file" | "folder";
  parentPath: string | null;
  expanded?: boolean;
  expand?: TreeActionHandler;
  collapse?: TreeActionHandler;
  actions: Partial<Record<FileTreeAction, TreeActionHandler>>;
}

interface RegisteredFileTreeNode {
  current: () => FileTreeNodeSpec;
}

export interface FileTreeFocusedNode {
  path: string;
  label: string;
  kind: "file" | "folder";
}

export interface FileTreeKeyboardHandle {
  hasFocus: () => boolean;
  focusActive: () => Promise<void>;
  focusPath: (path: string | null) => Promise<void>;
  revealPath: (path: string) => Promise<void>;
  getFocusedNode: () => FileTreeFocusedNode | null;
  getTargetDirectory: () => string | null;
  runFocusedAction: (action: FileTreeAction) => Promise<boolean>;
}

interface FileTreeKeyboardContextValue {
  focusedPath: string | null;
  treeHasFocus: boolean;
  registerNode: (path: string, node: RegisteredFileTreeNode) => () => void;
  selectNode: (path: string) => void;
  restoreTreeFocus: (path: string) => void;
}

const FileTreeKeyboardContext = createContext<FileTreeKeyboardContextValue | null>(null);

function treeNodeId(path: string): string {
  return `ghost-tree-${encodeURIComponent(path)}`;
}

function parentDirectory(path: string): string | null {
  const separator = path.lastIndexOf("/");
  return separator > 0 ? path.slice(0, separator) : null;
}

function hasPrimaryModifier(event: KeyboardEvent<HTMLDivElement>): boolean {
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  return event.metaKey || (!isMac && event.ctrlKey);
}

export function useFileTreeNode(spec: FileTreeNodeSpec) {
  const context = useContext(FileTreeKeyboardContext);
  if (!context) throw new Error("File tree nodes must be rendered inside FileTreeKeyboard");

  const latestSpec = useRef(spec);
  latestSpec.current = spec;

  useEffect(
    () => context.registerNode(spec.path, { current: () => latestSpec.current }),
    [context.registerNode, spec.path],
  );

  const isSelected = context.focusedPath === spec.path;
  const isFocused = isSelected && context.treeHasFocus;

  return {
    isFocused,
    nodeProps: {
      id: treeNodeId(spec.path),
      role: "treeitem" as const,
      tabIndex: -1,
      "data-ghost-tree-node": "",
      "data-tree-path": spec.path,
      "data-tree-focused": isSelected || undefined,
      "aria-expanded": spec.kind === "folder" ? Boolean(spec.expanded) : undefined,
      onMouseDown: (event: MouseEvent<HTMLElement>) => {
        // Treeitems contain their descendant group in the DOM. Without
        // stopping propagation, selecting a child also runs every ancestor's
        // handler and briefly highlights the parent until click completes.
        event.stopPropagation();
        context.selectNode(spec.path);
      },
      onFocus: (event: FocusEvent<HTMLElement>) => {
        // React focus events bubble. A child file's focused button therefore
        // also reaches every ancestor folder treeitem unless stopped here.
        event.stopPropagation();
        context.selectNode(spec.path);
      },
    },
    restoreTreeFocus: () => context.restoreTreeFocus(spec.path),
  };
}

interface FileTreeKeyboardProps {
  activePath: string | null;
  className?: string;
  children: ReactNode;
  scrollRef?: RefObject<HTMLDivElement | null>;
  onFocusEditor: () => void;
}

export const FileTreeKeyboard = forwardRef<FileTreeKeyboardHandle, FileTreeKeyboardProps>(
  function FileTreeKeyboard(
    { activePath, className, children, scrollRef, onFocusEditor },
    forwardedRef,
  ) {
    const rootRef = useRef<HTMLDivElement>(null);
    const nodesRef = useRef(new Map<string, RegisteredFileTreeNode>());
    const [focusedPath, setFocusedPath] = useState<string | null>(null);
    const [treeHasFocus, setTreeHasFocus] = useState(false);
    const typeAheadRef = useRef({ value: "", at: 0 });
    const suppressRootRevealRef = useRef(false);
    const activePathRef = useRef(activePath);
    activePathRef.current = activePath;

    const setRootRef = useCallback((element: HTMLDivElement | null) => {
      rootRef.current = element;
      if (scrollRef) scrollRef.current = element;
    }, [scrollRef]);

    const registerNode = useCallback((path: string, node: RegisteredFileTreeNode) => {
      nodesRef.current.set(path, node);
      return () => {
        if (nodesRef.current.get(path) === node) nodesRef.current.delete(path);
      };
    }, []);

    const visiblePaths = useCallback((): string[] => {
      const root = rootRef.current;
      if (!root) return [];
      return Array.from(root.querySelectorAll<HTMLElement>("[data-ghost-tree-node]"))
        .map((element) => element.dataset.treePath)
        .filter((path): path is string => Boolean(path));
    }, []);

    const selectNode = useCallback((path: string) => {
      setFocusedPath(path);
    }, []);

    const focusRootWithoutReveal = useCallback(() => {
      const root = rootRef.current;
      if (!root) return;
      suppressRootRevealRef.current = true;
      try {
        root.focus({ preventScroll: true });
      } finally {
        suppressRootRevealRef.current = false;
      }
    }, []);

    const restoreTreeRootFocus = focusRootWithoutReveal;

    const showVisiblePath = useCallback((
      path: string,
      options: { focusTree?: boolean; block?: ScrollLogicalPosition } = {},
    ) => {
      const root = rootRef.current;
      const element = document.getElementById(treeNodeId(path));
      if (!root || !element || !root.contains(element)) return false;
      setFocusedPath(path);
      if (options.focusTree !== false) focusRootWithoutReveal();

      // A folder's treeitem wraps its descendant group for correct ARIA
      // semantics. Scrolling that whole container can pin the folder row to
      // the top because its bounding box is as tall as the entire subtree.
      // Always scroll the visible row instead.
      const scrollTarget = element.querySelector<HTMLElement>("[data-tree-focus-target]") ?? element;
      scrollTarget.scrollIntoView({ block: options.block ?? "nearest" });
      return true;
    }, [focusRootWithoutReveal]);

    const restoreNodeFocus = useCallback((path: string) => {
      const root = rootRef.current;
      if (!root) return;

      // Pointer activation generally leaves focus on the clicked row. In
      // that case, only update the logical selection—forcing focus back onto
      // the tree root can run its stale onFocus handler and jump the scroll
      // position to the previously selected item.
      if (root.contains(document.activeElement)) {
        setFocusedPath(path);
        return;
      }
      showVisiblePath(path);
    }, [showVisiblePath]);

    const ensurePathVisible = useCallback(async (
      requestedPath: string | null,
      options: { focusTree: boolean; block: ScrollLogicalPosition },
    ) => {
      const root = rootRef.current;
      if (!root) return;
      if (options.focusTree) focusRootWithoutReveal();

      const targetPath = requestedPath ?? activePathRef.current;
      if (!targetPath) {
        const first = visiblePaths()[0];
        if (first) showVisiblePath(first, options);
        return;
      }

      const deadline = Date.now() + 2500;
      while (Date.now() < deadline) {
        if (showVisiblePath(targetPath, options)) return;

        const expandableAncestor = Array.from(nodesRef.current.values())
          .map((entry) => entry.current())
          .filter((node) =>
            node.kind === "folder" &&
            !node.expanded &&
            targetPath.startsWith(`${node.path}/`),
          )
          .sort((a, b) => b.path.length - a.path.length)[0];

        if (expandableAncestor?.expand) await expandableAncestor.expand();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }

      const fallback = visiblePaths()
        .filter((path) => targetPath.startsWith(`${path}/`))
        .sort((a, b) => b.length - a.length)[0] ?? visiblePaths()[0];
      if (fallback) showVisiblePath(fallback, options);
    }, [focusRootWithoutReveal, showVisiblePath, visiblePaths]);

    const focusPath = useCallback(
      (requestedPath: string | null) => ensurePathVisible(requestedPath, {
        focusTree: true,
        block: "center",
      }),
      [ensurePathVisible],
    );

    const revealPath = useCallback(
      (path: string) => ensurePathVisible(path, {
        focusTree: false,
        block: "center",
      }),
      [ensurePathVisible],
    );

    const getFocusedSpec = useCallback((): FileTreeNodeSpec | null => {
      const visible = visiblePaths();
      const candidate = focusedPath && visible.includes(focusedPath)
        ? focusedPath
        : activePathRef.current && visible.includes(activePathRef.current)
          ? activePathRef.current
          : visible[0];
      return candidate ? nodesRef.current.get(candidate)?.current() ?? null : null;
    }, [focusedPath, visiblePaths]);

    const getProjectRootPath = useCallback((path: string): string | null => {
      let node = nodesRef.current.get(path)?.current() ?? null;
      const visited = new Set<string>();

      while (node && node.parentPath && !visited.has(node.path)) {
        visited.add(node.path);
        const parent = nodesRef.current.get(node.parentPath)?.current() ?? null;
        if (!parent) break;
        node = parent;
      }

      return node?.parentPath === null ? node.path : null;
    }, []);

    const visiblePathsInProject = useCallback((path: string, paths: string[]) => {
      const projectRoot = getProjectRootPath(path);
      if (!projectRoot) return paths;
      return paths.filter((candidate) => getProjectRootPath(candidate) === projectRoot);
    }, [getProjectRootPath]);

    const runFocusedAction = useCallback(async (action: FileTreeAction): Promise<boolean> => {
      const node = getFocusedSpec();
      if (!node) return false;

      let handler = node.actions[action];
      if (action === "preview" && !handler) handler = node.actions.activate;
      if (!handler) return false;

      await handler();
      return true;
    }, [getFocusedSpec]);

    const getFocusedNode = useCallback((): FileTreeFocusedNode | null => {
      const node = getFocusedSpec();
      return node ? { path: node.path, label: node.label, kind: node.kind } : null;
    }, [getFocusedSpec]);

    useImperativeHandle(forwardedRef, () => ({
      hasFocus: () => Boolean(rootRef.current?.contains(document.activeElement)),
      focusActive: () => focusPath(activePathRef.current),
      focusPath,
      revealPath,
      getFocusedNode,
      getTargetDirectory: () => {
        const node = getFocusedSpec();
        if (!node) return null;
        return node.kind === "folder" ? node.path : parentDirectory(node.path);
      },
      runFocusedAction,
    }), [focusPath, getFocusedNode, getFocusedSpec, revealPath, runFocusedAction]);

    const moveFocus = useCallback((offset: number) => {
      const paths = visiblePaths();
      if (paths.length === 0) return;
      const currentIndex = focusedPath ? paths.indexOf(focusedPath) : -1;
      const nextIndex = Math.max(0, Math.min(paths.length - 1, currentIndex + offset));
      showVisiblePath(paths[nextIndex]);
    }, [focusedPath, showVisiblePath, visiblePaths]);

    const moveFocusByPage = useCallback((direction: -1 | 1) => {
      const root = rootRef.current;
      const paths = visiblePaths();
      if (!root || paths.length === 0) return;

      const currentIndex = focusedPath ? paths.indexOf(focusedPath) : -1;
      if (currentIndex < 0) {
        showVisiblePath(direction > 0 ? paths[paths.length - 1] : paths[0]);
        return;
      }

      const rowForPath = (path: string) => {
        const item = document.getElementById(treeNodeId(path));
        return item?.querySelector<HTMLElement>("[data-tree-focus-target]") ?? item;
      };
      const currentRow = rowForPath(paths[currentIndex]);
      const viewportHeight = root.clientHeight;

      // Page navigation traditionally moves by one viewport minus a row so
      // users retain a small amount of visual context. Fall back to ten rows
      // when layout metrics are unavailable (for example, in tests).
      if (!currentRow || viewportHeight <= 0) {
        const fallbackIndex = currentIndex + direction * 10;
        showVisiblePath(paths[Math.max(0, Math.min(paths.length - 1, fallbackIndex))]);
        return;
      }

      const currentRect = currentRow.getBoundingClientRect();
      const distance = Math.max(currentRect.height, viewportHeight - currentRect.height);
      const targetY = currentRect.top + direction * distance;
      let targetIndex = direction > 0 ? paths.length - 1 : 0;

      if (direction > 0) {
        for (let index = currentIndex + 1; index < paths.length; index += 1) {
          const row = rowForPath(paths[index]);
          if (row && row.getBoundingClientRect().top >= targetY) {
            targetIndex = index;
            break;
          }
        }
      } else {
        for (let index = currentIndex - 1; index >= 0; index -= 1) {
          const row = rowForPath(paths[index]);
          if (row && row.getBoundingClientRect().top <= targetY) {
            targetIndex = index;
            break;
          }
        }
      }

      showVisiblePath(paths[targetIndex]);
    }, [focusedPath, showVisiblePath, visiblePaths]);

    const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      if (target.matches("input, textarea, [contenteditable=true]")) return;

      const node = getFocusedSpec();
      const paths = visiblePaths();
      const currentIndex = node ? paths.indexOf(node.path) : -1;
      const command = hasPrimaryModifier(event);

      if (command && event.key === "ArrowUp") {
        event.preventDefault();
        const projectRoot = node ? getProjectRootPath(node.path) : null;
        const projectPaths = node && node.path !== projectRoot
          ? visiblePathsInProject(node.path, paths)
          : paths;
        if (projectPaths[0]) showVisiblePath(projectPaths[0]);
        return;
      }
      if (command && event.key === "ArrowDown") {
        event.preventDefault();
        const projectRoot = node ? getProjectRootPath(node.path) : null;
        const projectPaths = node && node.path !== projectRoot
          ? visiblePathsInProject(node.path, paths)
          : paths;
        const last = projectPaths[projectPaths.length - 1];
        if (last) showVisiblePath(last);
        return;
      }
      if (!command && event.altKey && event.key === "ArrowUp") {
        event.preventDefault();
        moveFocusByPage(-1);
        return;
      }
      if (!command && event.altKey && event.key === "ArrowDown") {
        event.preventDefault();
        moveFocusByPage(1);
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveFocus(1);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        moveFocus(-1);
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        if (paths[0]) showVisiblePath(paths[0]);
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        const last = paths[paths.length - 1];
        if (last) showVisiblePath(last);
        return;
      }
      if (event.key === "ArrowRight" && node?.kind === "folder") {
        event.preventDefault();
        if (!node.expanded) {
          void Promise.resolve(node.expand?.()).then(restoreTreeRootFocus);
        } else {
          const nextPath = paths[currentIndex + 1];
          const nextNode = nextPath ? nodesRef.current.get(nextPath)?.current() : null;
          if (nextNode?.parentPath === node.path) showVisiblePath(nextPath);
        }
        return;
      }
      if (event.key === "ArrowLeft" && node) {
        event.preventDefault();
        if (node.kind === "folder" && node.expanded) {
          void Promise.resolve(node.collapse?.()).then(restoreTreeRootFocus);
        } else if (node.parentPath) {
          showVisiblePath(node.parentPath);
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onFocusEditor();
        return;
      }
      if (event.key === " " && node) {
        event.preventDefault();
        if (node.kind === "folder") {
          const action = node.expanded ? node.collapse : node.expand;
          void Promise.resolve(action?.()).then(restoreTreeRootFocus);
        } else {
          void runFocusedAction("preview").then(restoreTreeRootFocus);
        }
        return;
      }
      if (event.key === "Enter" && command && node?.kind === "file") {
        event.preventDefault();
        void runFocusedAction("openNewWindow").then(restoreTreeRootFocus);
        return;
      }
      if (event.key === "Enter" && node) {
        event.preventDefault();
        if (node.kind === "folder") {
          const action = node.expanded ? node.collapse : node.expand;
          void Promise.resolve(action?.()).then(restoreTreeRootFocus);
        } else {
          void runFocusedAction("activate").then(onFocusEditor);
        }
        return;
      }
      if (event.key === "F2" && node) {
        event.preventDefault();
        void runFocusedAction("rename");
        return;
      }
      if (command && event.key.toLowerCase() === "d" && node) {
        event.preventDefault();
        void runFocusedAction("duplicate").then(restoreTreeRootFocus);
        return;
      }
      if (command && event.key === "Backspace" && node) {
        event.preventDefault();
        void runFocusedAction("trash");
        return;
      }

      if (
        event.key.length === 1 &&
        !command &&
        !event.altKey &&
        event.key !== " " &&
        /\S/.test(event.key)
      ) {
        const now = Date.now();
        const previous = now - typeAheadRef.current.at < 700 ? typeAheadRef.current.value : "";
        const query = `${previous}${event.key}`.toLocaleLowerCase();
        typeAheadRef.current = { value: query, at: now };

        const ordered = currentIndex >= 0
          ? [...paths.slice(currentIndex + 1), ...paths.slice(0, currentIndex + 1)]
          : paths;
        const match = ordered.find((path) =>
          nodesRef.current.get(path)?.current().label.toLocaleLowerCase().startsWith(query),
        );
        if (match) {
          event.preventDefault();
          showVisiblePath(match);
        }
      }
    }, [getFocusedSpec, getProjectRootPath, moveFocus, moveFocusByPage, onFocusEditor, restoreTreeRootFocus, runFocusedAction, showVisiblePath, visiblePaths, visiblePathsInProject]);

    const contextValue = useMemo<FileTreeKeyboardContextValue>(() => ({
      focusedPath,
      treeHasFocus,
      registerNode,
      selectNode,
      restoreTreeFocus: restoreNodeFocus,
    }), [focusedPath, registerNode, restoreNodeFocus, selectNode, treeHasFocus]);

    return (
      <FileTreeKeyboardContext.Provider value={contextValue}>
        <div
          ref={setRootRef}
          role="tree"
          data-tree-area
          aria-label="Workspace files"
          aria-activedescendant={focusedPath ? treeNodeId(focusedPath) : undefined}
          tabIndex={0}
          className={className}
          onFocusCapture={() => setTreeHasFocus(true)}
          onBlurCapture={(event) => {
            const nextTarget = event.relatedTarget;
            if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
              setTreeHasFocus(false);
            }
          }}
          onFocus={(event) => {
            if (event.target !== event.currentTarget) return;
            if (suppressRootRevealRef.current) return;
            const paths = visiblePaths();
            const preferred = focusedPath && paths.includes(focusedPath)
              ? focusedPath
              : activePathRef.current && paths.includes(activePathRef.current)
                ? activePathRef.current
                : paths[0];
            if (preferred) showVisiblePath(preferred);
          }}
          onKeyDown={handleKeyDown}
        >
          {children}
        </div>
      </FileTreeKeyboardContext.Provider>
    );
  },
);
