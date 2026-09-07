import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { CloudCollaborationSession, CloudCollaborationSnapshot } from "@/cloud/collaboration/types";

/** The session's snapshot as React state, following every change. */
export function useSessionSnapshot(session: CloudCollaborationSession | null): CloudCollaborationSnapshot | null {
  return useSyncExternalStore(
    useCallback((listener: () => void) => (session ? session.subscribe(() => listener()) : () => undefined), [session]),
    () => (session ? session.getSnapshot() : null),
  );
}

/** Names of everyone with a cursor in the document, this user included. */
export function usePresenceNames(session: CloudCollaborationSession | null): string[] {
  const [names, setNames] = useState<string[]>([]);
  useEffect(() => {
    if (!session) {
      setNames([]);
      return;
    }
    const refresh = () => {
      const next = Array.from(session.awareness.getStates().values())
        .map((state) => state?.user?.name)
        .filter((name): name is string => typeof name === "string");
      setNames(Array.from(new Set(next)));
    };
    refresh();
    session.awareness.on("change", refresh);
    return () => session.awareness.off("change", refresh);
  }, [session]);
  return names;
}
