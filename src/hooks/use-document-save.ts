import { useCallback, useRef, useState } from "react";
import type { Text } from "@codemirror/state";
import type { LocalDocumentRef } from "@/lib/document-ref";
import {
  tauriLocalDocumentSource,
  type LocalDocumentSource,
} from "@/lib/local-document-source";
import {
  iterateSourceChunks,
  type FileVersionToken,
  type SourceDocumentSnapshot,
} from "@/lib/source-document";

export type DocumentSaveStatus = "saved" | "saving" | "error";

export interface DocumentSaveError {
  kind: "conflict" | "io";
  message: string;
}

type FailedSave =
  | { kind: "text"; ref: LocalDocumentRef; content: string }
  | { kind: "source"; ref: LocalDocumentRef; snapshot: SourceDocumentSnapshot };

interface UseDocumentSaveOptions {
  knownDiskContent: React.RefObject<string | null>;
  knownDiskVersion?: React.RefObject<FileVersionToken | null>;
  lastSaveTimestamp: React.RefObject<number>;
  source?: LocalDocumentSource;
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
  knownDiskVersion,
  lastSaveTimestamp,
  source = tauriLocalDocumentSource,
}: UseDocumentSaveOptions) {
  const [status, setStatus] = useState<DocumentSaveStatus>("saved");
  const [error, setError] = useState<DocumentSaveError | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingCountRef = useRef(0);
  const latestRequestRef = useRef(0);
  const latestQueuedRef = useRef<{
    ref: LocalDocumentRef;
    content: string;
    promise: Promise<void>;
  } | null>(null);
  const failedSaveRef = useRef<FailedSave | null>(null);
  const hasFailedSaveRef = useRef(false);
  const latestQueuedSourceRef = useRef<{
    ref: LocalDocumentRef;
    document: Text;
    promise: Promise<void>;
  } | null>(null);

  const save = useCallback(
    (ref: LocalDocumentRef, content: string, force = false): Promise<void> => {
      const queued = latestQueuedRef.current;
      if (
        !force
        && pendingCountRef.current > 0
        && queued?.ref.path === ref.path
        && queued.content === content
      ) {
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
          const nextVersion = await source.writeText(ref, {
            content,
            expectedContent: force ? null : knownDiskContent.current,
            expectedVersion: force ? null : knownDiskVersion?.current ?? null,
            force,
          });
          knownDiskContent.current = content;
          if (knownDiskVersion) knownDiskVersion.current = nextVersion;
          lastSaveTimestamp.current = Date.now();
          failedSaveRef.current = null;
          hasFailedSaveRef.current = false;
        });

      queueRef.current = promise;
      latestQueuedRef.current = { ref, content, promise };

      promise
        .then(() => {
          if (requestId === latestRequestRef.current) {
            setStatus("saved");
            setError(null);
          }
        })
        .catch((saveError) => {
          failedSaveRef.current = { kind: "text", ref, content };
          hasFailedSaveRef.current = true;
          if (requestId === latestRequestRef.current) {
            setStatus("error");
            setError(normalizeSaveError(saveError));
          }
        })
        .finally(() => {
          pendingCountRef.current = Math.max(0, pendingCountRef.current - 1);
          if (latestQueuedRef.current?.promise === promise) latestQueuedRef.current = null;
        });

      return promise;
    },
    [knownDiskContent, knownDiskVersion, lastSaveTimestamp, source],
  );

  const saveSource = useCallback(
    (ref: LocalDocumentRef, snapshot: SourceDocumentSnapshot, force = false): Promise<void> => {
      const queued = latestQueuedSourceRef.current;
      if (
        !force
        && pendingCountRef.current > 0
        && queued?.ref.path === ref.path
        && queued.document === snapshot.document
      ) {
        return queued.promise;
      }

      const requestId = ++latestRequestRef.current;
      pendingCountRef.current += 1;
      setStatus("saving");
      setError(null);

      const promise = queueRef.current
        .catch(() => undefined)
        .then(async () => {
          const session = await source.beginSourceWrite(ref, {
            expectedVersion: force ? null : knownDiskVersion?.current ?? null,
            force,
          });
          let committed = false;
          try {
            for (const chunk of iterateSourceChunks(snapshot)) {
              await source.appendSourceWrite(session, chunk);
            }
            const nextVersion = await source.commitSourceWrite(session);
            if (knownDiskVersion) knownDiskVersion.current = nextVersion;
            committed = true;
            // The source editor owns the canonical text tree. Keeping an old
            // complete string here would make focus reload comparisons unsafe.
            knownDiskContent.current = null;
            lastSaveTimestamp.current = Date.now();
            failedSaveRef.current = null;
            hasFailedSaveRef.current = false;
          } finally {
            if (!committed) {
              await source.abortSourceWrite(session).catch(() => undefined);
            }
          }
        });

      queueRef.current = promise;
      latestQueuedSourceRef.current = { ref, document: snapshot.document, promise };

      promise
        .then(() => {
          if (requestId === latestRequestRef.current) {
            setStatus("saved");
            setError(null);
          }
        })
        .catch((saveError) => {
          failedSaveRef.current = { kind: "source", ref, snapshot };
          hasFailedSaveRef.current = true;
          if (requestId === latestRequestRef.current) {
            setStatus("error");
            setError(normalizeSaveError(saveError));
          }
        })
        .finally(() => {
          pendingCountRef.current = Math.max(0, pendingCountRef.current - 1);
          if (latestQueuedSourceRef.current?.promise === promise) latestQueuedSourceRef.current = null;
        });

      return promise;
    },
    [knownDiskContent, knownDiskVersion, lastSaveTimestamp, source],
  );

  const retry = useCallback(
    (force = false) => {
      const failed = failedSaveRef.current;
      if (!failed) return Promise.resolve();
      return failed.kind === "text"
        ? save(failed.ref, failed.content, force)
        : saveSource(failed.ref, failed.snapshot, force);
    },
    [save, saveSource],
  );

  const flush = useCallback(async () => {
    await queueRef.current;
  }, []);

  return {
    status,
    error,
    pendingSaveRef: pendingCountRef,
    hasFailedSaveRef,
    save,
    saveSource,
    retry,
    flush,
  };
}
