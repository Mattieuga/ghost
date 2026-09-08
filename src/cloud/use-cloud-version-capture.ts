import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as Y from "yjs";
import { encodeBase64 } from "@/cloud/collaboration/base64";
import type { CloudCollaborationSession } from "@/cloud/collaboration/types";
import {
  automaticVersionDelay,
  automaticVersionMaximumDelay,
  createCloudDocumentVersion,
  listCloudDocumentVersions,
  type CloudDocumentVersion,
  type CloudDocumentVersionReason,
} from "@/cloud/cloud-version-history";
import { serializeMarkdownDocument } from "@/components/editor/markdown-source";

function newestFirst(versions: CloudDocumentVersion[]): CloudDocumentVersion[] {
  return [...versions].sort((left, right) => (
    new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
    || right.id - left.id
  ));
}

export interface CloudVersionCapture {
  versions: CloudDocumentVersion[];
  loading: boolean;
  saving: boolean;
  error: string | null;
  refresh(): Promise<CloudDocumentVersion[]>;
  capture(reason: CloudDocumentVersionReason, restoredFromVersionId?: number | null): Promise<CloudDocumentVersion | null>;
  /** Cancel a pending automatic capture, before a restore. */
  cancelScheduled(): void;
}

/**
 * Cloud version history for one open document: the list, and automatic
 * captures while editing. An initial version is saved when the document's
 * text differs from the latest, then active editing is grouped into
 * versions by idle time, with a ceiling. Same rules on the Mac and the web.
 */
export function useCloudVersionCapture(
  client: SupabaseClient | null,
  documentId: string | null,
  editor: Editor | null,
  session: CloudCollaborationSession | null,
  networkReady: boolean,
): CloudVersionCapture {
  const [versions, setVersions] = useState<CloudDocumentVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maximumTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestCreatedAtRef = useRef<string | null>(null);
  const changeRevisionRef = useRef(0);
  const dirtyRef = useRef(false);
  const capturePromiseRef = useRef<Promise<CloudDocumentVersion | null> | null>(null);
  const active = Boolean(client && documentId && editor && session);
  // The session reports "synced" again after every collaborator's flush.
  // History needs the network once per document, not a fresh start each
  // time, so readiness is latched the first time it is seen.
  const [readyDocument, setReadyDocument] = useState<string | null>(null);
  useEffect(() => {
    if (networkReady && documentId) setReadyDocument(documentId);
  }, [documentId, networkReady]);
  const ready = readyDocument !== null && readyDocument === documentId;

  useEffect(() => {
    setVersions([]);
    latestCreatedAtRef.current = null;
    dirtyRef.current = false;
  }, [documentId]);

  const refresh = useCallback(async () => {
    if (!client || !documentId) return [];
    setLoading(true);
    setError(null);
    try {
      const next = await listCloudDocumentVersions(client, documentId);
      setVersions(next);
      latestCreatedAtRef.current = next[0]?.created_at ?? null;
      return next;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load document history.");
      return [];
    } finally {
      setLoading(false);
    }
  }, [client, documentId]);

  const capture = useCallback((
    reason: CloudDocumentVersionReason,
    restoredFromVersionId: number | null = null,
  ): Promise<CloudDocumentVersion | null> => {
    if (!client || !documentId || !editor || !session || session.role !== "editor") return Promise.resolve(null);
    if (capturePromiseRef.current) return capturePromiseRef.current;
    const revisionAtStart = changeRevisionRef.current;
    setSaving(true);
    if (reason !== "automatic") setError(null);
    const promise = (async () => {
      await session.flush();
      const markdownSnapshot = serializeMarkdownDocument(editor);
      const version = await createCloudDocumentVersion(client, {
        documentId,
        markdownSnapshot,
        yjsSnapshot: encodeBase64(Y.encodeStateAsUpdate(session.document)),
        reason,
        restoredFromVersionId,
      });
      latestCreatedAtRef.current = version.created_at;
      setVersions((current) => newestFirst([version, ...current.filter((candidate) => candidate.id !== version.id)]));
      dirtyRef.current = changeRevisionRef.current !== revisionAtStart || version.markdown_snapshot !== markdownSnapshot;
      return version;
    })().catch((reason: unknown) => {
      // A background capture that fails tries again later; only a capture
      // the user asked for, such as a restore, is worth a message.
      if (reason !== "automatic") setError(reason instanceof Error ? reason.message : "Could not save document history.");
      return null;
    }).finally(() => {
      capturePromiseRef.current = null;
      setSaving(false);
    });
    capturePromiseRef.current = promise;
    return promise;
  }, [client, documentId, editor, session]);

  const cancelScheduled = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (maximumTimerRef.current) clearTimeout(maximumTimerRef.current);
    timerRef.current = null;
    maximumTimerRef.current = null;
  }, []);

  const scheduleAutomatic = useCallback(() => {
    if (!session || session.role !== "editor") return;
    if (timerRef.current) clearTimeout(timerRef.current);
    const run = () => {
      cancelScheduled();
      if (!dirtyRef.current) return;
      void capture("automatic").then(() => {
        if (dirtyRef.current) scheduleAutomatic();
      });
    };
    timerRef.current = setTimeout(run, automaticVersionDelay(latestCreatedAtRef.current));
    if (!maximumTimerRef.current) {
      maximumTimerRef.current = setTimeout(run, automaticVersionMaximumDelay(latestCreatedAtRef.current));
    }
  }, [cancelScheduled, capture, session]);

  useEffect(() => {
    if (!active || !ready || !editor || !session) return;
    let live = true;
    void refresh().then((loaded) => {
      if (!live || session.role !== "editor") return;
      const latest = loaded[0];
      if (!latest || latest.markdown_snapshot !== serializeMarkdownDocument(editor)) {
        void capture("automatic").then(() => {
          if (dirtyRef.current) scheduleAutomatic();
        });
      }
    });
    return () => { live = false; };
  }, [active, capture, editor, ready, refresh, scheduleAutomatic, session]);

  useEffect(() => {
    if (!active || !ready || !editor || !session || session.role !== "editor") return;
    const handleUpdate = () => {
      changeRevisionRef.current += 1;
      dirtyRef.current = true;
      scheduleAutomatic();
    };
    editor.on("update", handleUpdate);
    return () => { editor.off("update", handleUpdate); };
  }, [active, editor, ready, scheduleAutomatic, session]);

  useEffect(() => () => cancelScheduled(), [cancelScheduled]);

  return { versions, loading, saving, error, refresh, capture, cancelScheduled };
}
