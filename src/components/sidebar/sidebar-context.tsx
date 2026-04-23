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
