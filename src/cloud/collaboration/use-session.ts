import { useEffect, useState } from "react";
import type { CloudCollaborationSession, CloudCollaborationSnapshot } from "@/cloud/collaboration/types";

/**
 * The session's snapshot as React state, following every change. Plain
 * state rather than an external-store subscription: `getSnapshot()` builds
 * a fresh object each call, which the store hook would read as a change on
 * every render.
 */
export function useSessionSnapshot(session: CloudCollaborationSession | null): CloudCollaborationSnapshot | null {
  const [snapshot, setSnapshot] = useState<CloudCollaborationSnapshot | null>(() => session?.getSnapshot() ?? null);
  useEffect(() => {
    if (!session) {
      setSnapshot(null);
      return;
    }
    setSnapshot(session.getSnapshot());
    return session.subscribe(setSnapshot);
  }, [session]);
  return snapshot;
}

/** Names of the other people in the document. This user is not listed. */
export function usePresenceNames(session: CloudCollaborationSession | null): string[] {
  const [names, setNames] = useState<string[]>([]);
  useEffect(() => {
    if (!session) {
      setNames([]);
      return;
    }
    const refresh = () => {
      const next = Array.from(session.awareness.getStates().entries())
        .filter(([clientId]) => clientId !== session.awareness.clientID)
        .map(([, state]) => state?.user?.name)
        .filter((name): name is string => typeof name === "string");
      setNames(Array.from(new Set(next)));
    };
    refresh();
    session.awareness.on("change", refresh);
    return () => session.awareness.off("change", refresh);
  }, [session]);
  return names;
}
