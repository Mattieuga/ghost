import { createContext, useContext, useSyncExternalStore, useCallback } from "react";

type Listener = () => void;

class ActiveFileStore {
  private path: string | null = null;
  private listeners = new Set<Listener>();

  get() { return this.path; }

  set(path: string | null) {
    if (this.path === path) return;
    this.path = path;
    this.listeners.forEach((l) => l());
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

const ActiveFileContext = createContext<ActiveFileStore>(new ActiveFileStore());

export const ActiveFileProvider = ActiveFileContext.Provider;

export function useActiveFileStore() {
  return useContext(ActiveFileContext);
}

export function useIsActiveFile(path: string): boolean {
  const store = useContext(ActiveFileContext);
  return useSyncExternalStore(
    useCallback((cb) => store.subscribe(cb), [store]),
    () => store.get() === path,
  );
}

export { ActiveFileStore };

/**
 * Sync-related actions the layout offers to rows deep in the tree. Rows ask
 * for a root's kind to decide which items to show, and call back with paths.
 */
export interface SidebarActions {
  rootKindOf?: (path: string) => "plain" | "mirrored" | null;
  syncFolder?: (path: string) => void;
  stopSyncing?: (rootPath: string) => void;
  linkIntoProject?: (rootPath: string) => void;
  copyToNotes?: (filePath: string) => void;
  saveCopy?: (filePath: string) => void;
  /** True for the root that mirrors what other people shared. */
  isSharedRoot?: (rootPath: string) => boolean;
  /** Give up access to something shared with you, by its path in the Shared root. */
  leave?: (path: string) => void;
}

const SidebarActionsContext = createContext<SidebarActions>({});

export const SidebarActionsProvider = SidebarActionsContext.Provider;

export function useSidebarActions(): SidebarActions {
  return useContext(SidebarActionsContext);
}
