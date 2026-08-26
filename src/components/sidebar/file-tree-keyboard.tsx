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

type TreeActionHandler = () => void | boolean | Promise<void | boolean>;

interface FileTreeNodeSpec {
  key: string;
  path: string;
  projectPath: string;
  label: string;
  kind: "file" | "folder";
  parentKey: string | null;
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
  focusPath: (path: string | null, projectPath?: string) => Promise<void>;
  revealPath: (path: string) => Promise<void>;
  getFocusedNode: () => FileTreeFocusedNode | null;
  getTargetDirectory: () => string | null;
  runFocusedAction: (action: FileTreeAction) => Promise<boolean>;
}

interface FileTreeKeyboardContextValue {
  focusedKey: string | null;
  treeHasFocus: boolean;
  registerNode: (key: string, node: RegisteredFileTreeNode) => () => void;
  selectNode: (key: string) => void;
  restoreTreeFocus: (key: string) => void;
  focusPath: (path: string, projectPath?: string) => Promise<void>;
}

const FileTreeKeyboardContext = createContext<FileTreeKeyboardContextValue | null>(null);

function treeNodeKey(projectPath: string, path: string): string {
  return JSON.stringify([projectPath, path]);
}

function treeNodeId(key: string): string {
  return `ghost-tree-${encodeURIComponent(key)}`;
}

function parentDirectory(path: string): string | null {
  const separator = path.lastIndexOf("/");
  return separator > 0 ? path.slice(0, separator) : null;
}

function hasPrimaryModifier(event: KeyboardEvent<HTMLDivElement>): boolean {
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  return event.metaKey || (!isMac && event.ctrlKey);
}

export function useFileTreeNode(
  spec: Omit<FileTreeNodeSpec, "key" | "parentKey"> & { parentPath: string | null },
) {
  const context = useContext(FileTreeKeyboardContext);
  if (!context) throw new Error("File tree nodes must be rendered inside FileTreeKeyboard");

  const { parentPath, ...nodeSpec } = spec;
  const key = treeNodeKey(spec.projectPath, spec.path);
  const normalizedSpec: FileTreeNodeSpec = {
    ...nodeSpec,
    key,
    parentKey: parentPath ? treeNodeKey(spec.projectPath, parentPath) : null,
  };
  const latestSpec = useRef(normalizedSpec);
  latestSpec.current = normalizedSpec;

  useEffect(
    () => context.registerNode(key, { current: () => latestSpec.current }),
    [context.registerNode, key],
  );

  const isSelected = context.focusedKey === key;
  const isFocused = isSelected && context.treeHasFocus;

  return {
    isFocused,
    nodeProps: {
      id: treeNodeId(key),
      role: "treeitem" as const,
      tabIndex: -1,
      "data-ghost-tree-node": "",
      "data-tree-key": key,
      "data-tree-path": spec.path,
      "data-tree-focused": isSelected || undefined,
      "aria-expanded": spec.kind === "folder" ? Boolean(spec.expanded) : undefined,
      onMouseDown: (event: MouseEvent<HTMLElement>) => {
        // Treeitems contain their descendant group in the DOM. Without
        // stopping propagation, selecting a child also runs every ancestor's
        // handler and briefly highlights the parent until click completes.
        event.stopPropagation();
        context.selectNode(key);
      },
      onFocus: (event: FocusEvent<HTMLElement>) => {
        // React focus events bubble. A child file's focused button therefore
        // also reaches every ancestor folder treeitem unless stopped here.
        event.stopPropagation();
        context.selectNode(key);
      },
    },
    restoreTreeFocus: () => context.restoreTreeFocus(key),
    focusTreePath: (path: string, projectPath = spec.projectPath) =>
      context.focusPath(path, projectPath),
  };
}

interface FileTreeKeyboardProps {
  activePath: string | null;
  className?: string;
  children: ReactNode;
  scrollRef?: RefObject<HTMLDivElement | null>;
  onFocusEditor: (placement?: "preserve" | "start") => void;
}

export const FileTreeKeyboard = forwardRef<FileTreeKeyboardHandle, FileTreeKeyboardProps>(
  function FileTreeKeyboard(
    { activePath, className, children, scrollRef, onFocusEditor },
    forwardedRef,
  ) {
    const rootRef = useRef<HTMLDivElement>(null);
    const nodesRef = useRef(new Map<string, RegisteredFileTreeNode>());
    const [focusedKey, setFocusedKey] = useState<string | null>(null);
    const [treeHasFocus, setTreeHasFocus] = useState(false);
    const typeAheadRef = useRef({ value: "", at: 0 });
    const suppressRootRevealRef = useRef(false);
    const activePathRef = useRef(activePath);
    activePathRef.current = activePath;

    const setRootRef = useCallback((element: HTMLDivElement | null) => {
      rootRef.current = element;
      if (scrollRef) scrollRef.current = element;
    }, [scrollRef]);

    const registerNode = useCallback((key: string, node: RegisteredFileTreeNode) => {
      nodesRef.current.set(key, node);
      return () => {
        if (nodesRef.current.get(key) === node) nodesRef.current.delete(key);
      };
    }, []);

    const visibleKeys = useCallback((): string[] => {
      const root = rootRef.current;
      if (!root) return [];
      return Array.from(root.querySelectorAll<HTMLElement>("[data-ghost-tree-node]"))
        .map((element) => element.dataset.treeKey)
        .filter((key): key is string => Boolean(key));
    }, []);

    const selectNode = useCallback((key: string) => {
      setFocusedKey(key);
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
      key: string,
      options: { focusTree?: boolean; block?: ScrollLogicalPosition } = {},
    ) => {
      const root = rootRef.current;
      const element = document.getElementById(treeNodeId(key));
      if (!root || !element || !root.contains(element)) return false;
      setFocusedKey(key);
      if (options.focusTree !== false) focusRootWithoutReveal();

      // A folder's treeitem wraps its descendant group for correct ARIA
      // semantics. Scrolling that whole container can pin the folder row to
      // the top because its bounding box is as tall as the entire subtree.
      // Always scroll the visible row instead.
      const scrollTarget = element.querySelector<HTMLElement>("[data-tree-focus-target]") ?? element;
      const block = options.block ?? "nearest";
      const rootRect = root.getBoundingClientRect();
      const targetRect = scrollTarget.getBoundingClientRect();
      const fullyVisible = rootRect.height > 0 && targetRect.height > 0 &&
        targetRect.top >= rootRect.top && targetRect.bottom <= rootRect.bottom;
      if (block !== "nearest" || !fullyVisible) {
        scrollTarget.scrollIntoView({ block });
      }
      return true;
    }, [focusRootWithoutReveal]);

    const restoreNodeFocus = useCallback((key: string) => {
      const root = rootRef.current;
      if (!root) return;

      // Pointer activation generally leaves focus on the clicked row. In
      // that case, only update the logical selection—forcing focus back onto
      // the tree root can run its stale onFocus handler and jump the scroll
      // position to the previously selected item.
      if (root.contains(document.activeElement)) {
        setFocusedKey(key);
        return;
      }
      showVisiblePath(key);
    }, [showVisiblePath]);

    const preferredProjectForPath = useCallback((targetPath: string): string | undefined =>
      Array.from(nodesRef.current.values())
        .map((entry) => entry.current())
        .filter((node) =>
          node.parentKey === null &&
          (targetPath === node.projectPath || targetPath.startsWith(`${node.projectPath}/`)),
        )
        .sort((a, b) => b.projectPath.length - a.projectPath.length)[0]?.projectPath,
    []);

    const ensurePathVisible = useCallback(async (
      requestedPath: string | null,
      requestedProjectPath: string | undefined,
      options: { focusTree: boolean; block: ScrollLogicalPosition },
    ) => {
      const root = rootRef.current;
      if (!root) return;
      if (options.focusTree) focusRootWithoutReveal();

      const targetPath = requestedPath ?? activePathRef.current;
      if (!targetPath) {
        const first = visibleKeys()[0];
        if (first) showVisiblePath(first, options);
        return;
      }

      const matchingProject = requestedProjectPath ?? preferredProjectForPath(targetPath);

      const visibleOccurrence = () => visibleKeys().find((key) => {
        const node = nodesRef.current.get(key)?.current();
        return node?.path === targetPath && (!matchingProject || node.projectPath === matchingProject);
      });

      const deadline = Date.now() + 2500;
      while (Date.now() < deadline) {
        const exactKey = visibleOccurrence();
        if (exactKey && showVisiblePath(exactKey, options)) return;

        const expandableAncestor = Array.from(nodesRef.current.values())
          .map((entry) => entry.current())
          .filter((node) =>
            node.kind === "folder" &&
            !node.expanded &&
            targetPath.startsWith(`${node.path}/`) &&
            (!matchingProject || node.projectPath === matchingProject),
          )
          .sort((a, b) => b.path.length - a.path.length)[0];

        if (expandableAncestor?.expand) await expandableAncestor.expand();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }

      const fallback = visibleKeys()
        .filter((key) => {
          const node = nodesRef.current.get(key)?.current();
          return Boolean(
            node &&
            targetPath.startsWith(`${node.path}/`) &&
            (!matchingProject || node.projectPath === matchingProject),
          );
        })
        .sort((a, b) => {
          const aPath = nodesRef.current.get(a)?.current().path ?? "";
          const bPath = nodesRef.current.get(b)?.current().path ?? "";
          return bPath.length - aPath.length;
        })[0] ?? visibleKeys()[0];
      if (fallback) showVisiblePath(fallback, options);
    }, [focusRootWithoutReveal, preferredProjectForPath, showVisiblePath, visibleKeys]);

    const focusPath = useCallback(
      (requestedPath: string | null, projectPath?: string) => ensurePathVisible(requestedPath, projectPath, {
        focusTree: true,
        block: "nearest",
      }),
      [ensurePathVisible],
    );

    // Row-local actions such as rename already begin near the target. Keep
    // the row visible without recentering the entire sidebar when it remains
    // inside the viewport.
    const focusRowPath = useCallback(
      (requestedPath: string, projectPath?: string) => ensurePathVisible(requestedPath, projectPath, {
        focusTree: true,
        block: "nearest",
      }),
      [ensurePathVisible],
    );

    const revealPath = useCallback(
      (path: string) => ensurePathVisible(path, undefined, {
        focusTree: false,
        block: "center",
      }),
      [ensurePathVisible],
    );

    const getFocusedSpec = useCallback((): FileTreeNodeSpec | null => {
      const visible = visibleKeys();
      const activeProjectPath = activePathRef.current
        ? preferredProjectForPath(activePathRef.current)
        : undefined;
      const activeKey = activePathRef.current
        ? visible.find((key) => {
            const node = nodesRef.current.get(key)?.current();
            return node?.path === activePathRef.current &&
              (!activeProjectPath || node.projectPath === activeProjectPath);
          })
        : undefined;
      const candidate = focusedKey && visible.includes(focusedKey)
        ? focusedKey
        : activeKey ?? visible[0];
      return candidate ? nodesRef.current.get(candidate)?.current() ?? null : null;
    }, [focusedKey, preferredProjectForPath, visibleKeys]);

    const visibleKeysInProject = useCallback((projectPath: string, keys: string[]) =>
      keys.filter((key) => nodesRef.current.get(key)?.current().projectPath === projectPath), []);

    const runFocusedAction = useCallback(async (action: FileTreeAction): Promise<boolean> => {
      const node = getFocusedSpec();
      if (!node) return false;

      let handler = node.actions[action];
      if (action === "preview" && !handler) handler = node.actions.activate;
      if (!handler) return false;

      return await handler() !== false;
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
      const keys = visibleKeys();
      if (keys.length === 0) return;
      const currentIndex = focusedKey ? keys.indexOf(focusedKey) : -1;
      const nextIndex = Math.max(0, Math.min(keys.length - 1, currentIndex + offset));
      showVisiblePath(keys[nextIndex]);
    }, [focusedKey, showVisiblePath, visibleKeys]);

    const moveFocusByPage = useCallback((direction: -1 | 1) => {
      const root = rootRef.current;
      const keys = visibleKeys();
      if (!root || keys.length === 0) return;

      const currentIndex = focusedKey ? keys.indexOf(focusedKey) : -1;
      if (currentIndex < 0) {
        showVisiblePath(direction > 0 ? keys[keys.length - 1] : keys[0]);
        return;
      }

      const rowForKey = (key: string) => {
        const item = document.getElementById(treeNodeId(key));
        return item?.querySelector<HTMLElement>("[data-tree-focus-target]") ?? item;
      };
      const currentRow = rowForKey(keys[currentIndex]);
      const viewportHeight = root.clientHeight;

      // Page navigation traditionally moves by one viewport minus a row so
      // users retain a small amount of visual context. Fall back to ten rows
      // when layout metrics are unavailable (for example, in tests).
      if (!currentRow || viewportHeight <= 0) {
        const fallbackIndex = currentIndex + direction * 10;
        showVisiblePath(keys[Math.max(0, Math.min(keys.length - 1, fallbackIndex))]);
        return;
      }

      const currentRect = currentRow.getBoundingClientRect();
      const distance = Math.max(currentRect.height, viewportHeight - currentRect.height);
      const targetY = currentRect.top + direction * distance;
      let targetIndex = direction > 0 ? keys.length - 1 : 0;

      if (direction > 0) {
        for (let index = currentIndex + 1; index < keys.length; index += 1) {
          const row = rowForKey(keys[index]);
          if (row && row.getBoundingClientRect().top >= targetY) {
            targetIndex = index;
            break;
          }
        }
      } else {
        for (let index = currentIndex - 1; index >= 0; index -= 1) {
          const row = rowForKey(keys[index]);
          if (row && row.getBoundingClientRect().top <= targetY) {
            targetIndex = index;
            break;
          }
        }
      }

      showVisiblePath(keys[targetIndex]);
    }, [focusedKey, showVisiblePath, visibleKeys]);

    const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      if (target.matches("input, textarea, [contenteditable=true]")) return;

      const node = getFocusedSpec();
      const keys = visibleKeys();
      const currentIndex = node ? keys.indexOf(node.key) : -1;
      const command = hasPrimaryModifier(event);

      if (command && event.key === "ArrowUp") {
        event.preventDefault();
        const projectKeys = node && node.path !== node.projectPath
          ? visibleKeysInProject(node.projectPath, keys)
          : keys;
        if (projectKeys[0]) showVisiblePath(projectKeys[0]);
        return;
      }
      if (command && event.key === "ArrowDown") {
        event.preventDefault();
        const projectKeys = node && node.path !== node.projectPath
          ? visibleKeysInProject(node.projectPath, keys)
          : keys;
        const last = projectKeys[projectKeys.length - 1];
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
        if (keys[0]) showVisiblePath(keys[0]);
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        const last = keys[keys.length - 1];
        if (last) showVisiblePath(last);
        return;
      }
      if (event.key === "ArrowRight" && node?.kind === "folder") {
        event.preventDefault();
        if (!node.expanded) {
          void Promise.resolve(node.expand?.()).then(restoreTreeRootFocus);
        } else {
          const nextKey = keys[currentIndex + 1];
          const nextNode = nextKey ? nodesRef.current.get(nextKey)?.current() : null;
          if (nextNode?.parentKey === node.key) showVisiblePath(nextKey);
        }
        return;
      }
      if (event.key === "ArrowLeft" && node) {
        event.preventDefault();
        if (node.kind === "folder" && node.expanded) {
          void Promise.resolve(node.collapse?.()).then(restoreTreeRootFocus);
        } else if (node.parentKey) {
          showVisiblePath(node.parentKey);
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
          void runFocusedAction("activate").then((activated) => {
            if (activated) onFocusEditor("start");
            else restoreTreeRootFocus();
          });
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
          ? [...keys.slice(currentIndex + 1), ...keys.slice(0, currentIndex + 1)]
          : keys;
        const match = ordered.find((key) =>
          nodesRef.current.get(key)?.current().label.toLocaleLowerCase().startsWith(query),
        );
        if (match) {
          event.preventDefault();
          showVisiblePath(match);
        }
      }
    }, [getFocusedSpec, moveFocus, moveFocusByPage, onFocusEditor, restoreTreeRootFocus, runFocusedAction, showVisiblePath, visibleKeys, visibleKeysInProject]);

    const contextValue = useMemo<FileTreeKeyboardContextValue>(() => ({
      focusedKey,
      treeHasFocus,
      registerNode,
      selectNode,
      restoreTreeFocus: restoreNodeFocus,
      focusPath: focusRowPath,
    }), [focusRowPath, focusedKey, registerNode, restoreNodeFocus, selectNode, treeHasFocus]);

    return (
      <FileTreeKeyboardContext.Provider value={contextValue}>
        <div
          ref={setRootRef}
          role="tree"
          data-tree-area
          aria-label="Workspace files"
          aria-activedescendant={focusedKey ? treeNodeId(focusedKey) : undefined}
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
            const keys = visibleKeys();
            const activeProjectPath = activePathRef.current
              ? preferredProjectForPath(activePathRef.current)
              : undefined;
            const activeKey = activePathRef.current
              ? keys.find((key) => {
                  const node = nodesRef.current.get(key)?.current();
                  return node?.path === activePathRef.current &&
                    (!activeProjectPath || node.projectPath === activeProjectPath);
                })
              : undefined;
            const preferred = focusedKey && keys.includes(focusedKey)
              ? focusedKey
              : activeKey ?? keys[0];
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
