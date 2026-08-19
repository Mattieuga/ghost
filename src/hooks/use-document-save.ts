import { invoke } from "@tauri-apps/api/core";
import { useCallback, useRef, useState } from "react";

export type DocumentSaveStatus = "saved" | "saving" | "error";

export interface DocumentSaveError {
  kind: "conflict" | "io";
  message: string;
}

interface FailedSave {
  path: string;
  content: string;
}

interface UseDocumentSaveOptions {
  knownDiskContent: React.RefObject<string | null>;
  lastSaveTimestamp: React.RefObject<number>;
}

function normalizeSaveError(error: unknown): DocumentSaveError {
  if (error && typeof error === "object") {
    const candidate = error as { kind?: unknown; message?: unknown };
    if (candidate.kind === "conflict" || candidate.kind === "io") {
      return {
        kind: candidate.kind,
        message: typeof candidate.message === "string" ? candidate.message : "Save failed",
      };
    }
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    kind: /changed (?:on disk|outside ghost)|conflict/i.test(message) ? "conflict" : "io",
    message,
  };
}

/**
 * Owns the write lifecycle for one window. Saves are serialized, duplicate
 * flushes join the in-flight write, and every write verifies that the file on
 * disk still matches the version Ghost last read or successfully wrote.
 */
export function useDocumentSave({
  knownDiskContent,
  lastSaveTimestamp,
}: UseDocumentSaveOptions) {
  const [status, setStatus] = useState<DocumentSaveStatus>("saved");
  const [error, setError] = useState<DocumentSaveError | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingCountRef = useRef(0);
  const latestRequestRef = useRef(0);
  const latestQueuedRef = useRef<{
    path: string;
    content: string;
    promise: Promise<void>;
  } | null>(null);
  const failedSaveRef = useRef<FailedSave | null>(null);

  const save = useCallback(
    (path: string, content: string, force = false): Promise<void> => {
      const queued = latestQueuedRef.current;
      if (!force && pendingCountRef.current > 0 && queued?.path === path && queued.content === content) {
        return queued.promise;
      }
      if (!force && pendingCountRef.current === 0 && knownDiskContent.current === content) {
        return Promise.resolve();
      }

      const requestId = ++latestRequestRef.current;
      pendingCountRef.current += 1;
      setStatus("saving");
      setError(null);

      const promise = queueRef.current
        .catch(() => undefined)
        .then(async () => {
          await invoke("write_file", {
            path,
            content,
            expectedContent: force ? null : knownDiskContent.current,
            force,
          });
          knownDiskContent.current = content;
          lastSaveTimestamp.current = Date.now();
          failedSaveRef.current = null;
        });

      queueRef.current = promise;
      latestQueuedRef.current = { path, content, promise };

      promise
        .then(() => {
          if (requestId === latestRequestRef.current) {
            setStatus("saved");
            setError(null);
          }
        })
        .catch((saveError) => {
          failedSaveRef.current = { path, content };
          if (requestId === latestRequestRef.current) {
            setStatus("error");
            setError(normalizeSaveError(saveError));
          }
        })
        .finally(() => {
          pendingCountRef.current = Math.max(0, pendingCountRef.current - 1);
        });

      return promise;
    },
    [knownDiskContent, lastSaveTimestamp],
  );

  const retry = useCallback(
    (force = false) => {
      const failed = failedSaveRef.current;
      if (!failed) return Promise.resolve();
      return save(failed.path, failed.content, force);
    },
    [save],
  );

  return {
    status,
    error,
    pendingSaveRef: pendingCountRef,
    save,
    retry,
  };
}
