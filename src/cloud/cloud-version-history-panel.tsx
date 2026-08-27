import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { History, RotateCcw } from "lucide-react";
import * as Y from "yjs";
import { encodeBase64 } from "@/cloud/collaboration/base64";
import type { CloudCollaborationSession } from "@/cloud/collaboration/types";
import {
  automaticVersionDelay,
  automaticVersionMaximumDelay,
  createCloudDocumentVersion,
  formatCloudVersionReason,
  listCloudDocumentVersions,
  type CloudDocumentVersion,
  type CloudDocumentVersionReason,
} from "@/cloud/cloud-version-history";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

function newestFirst(versions: CloudDocumentVersion[]): CloudDocumentVersion[] {
  return [...versions].sort((left, right) => (
    new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
    || right.id - left.id
  ));
}

function putVersion(
  versions: CloudDocumentVersion[],
  version: CloudDocumentVersion,
): CloudDocumentVersion[] {
  return newestFirst([version, ...versions.filter((candidate) => candidate.id !== version.id)]);
}

function formatVersionTime(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

export function CloudVersionHistory({
  client,
  documentId,
  editor,
  networkReady,
  session,
}: {
  client: SupabaseClient;
  documentId: string;
  editor: Editor;
  networkReady: boolean;
  session: CloudCollaborationSession;
}) {
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<CloudDocumentVersion[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maximumTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestCreatedAtRef = useRef<string | null>(null);
  const changeRevisionRef = useRef(0);
  const dirtyRef = useRef(false);
  const capturePromiseRef = useRef<Promise<CloudDocumentVersion | null> | null>(null);

  const refreshVersions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await listCloudDocumentVersions(client, documentId);
      setVersions(next);
      setSelectedId((current) => current ?? next[0]?.id ?? null);
      latestCreatedAtRef.current = next[0]?.created_at ?? null;
      return next;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load document history.");
      return [];
    } finally {
      setLoading(false);
    }
  }, [client, documentId]);

  const captureVersion = useCallback((
    reason: CloudDocumentVersionReason,
    restoredFromVersionId: number | null = null,
  ): Promise<CloudDocumentVersion | null> => {
    if (session.role !== "editor") return Promise.resolve(null);
    if (capturePromiseRef.current) return capturePromiseRef.current;

    const revisionAtStart = changeRevisionRef.current;
    setSaving(true);
    setError(null);
    const promise = (async () => {
      await session.flush();
      const markdownSnapshot = editor.getMarkdown();
      const version = await createCloudDocumentVersion(client, {
        documentId,
        markdownSnapshot,
        yjsSnapshot: encodeBase64(Y.encodeStateAsUpdate(session.document)),
        reason,
        restoredFromVersionId,
      });
      latestCreatedAtRef.current = version.created_at;
      setVersions((current) => putVersion(current, version));
      setSelectedId((current) => current ?? version.id);
      dirtyRef.current = changeRevisionRef.current !== revisionAtStart
        || version.markdown_snapshot !== markdownSnapshot;
      return version;
    })().catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "Could not save document history.");
      return null;
    }).finally(() => {
      capturePromiseRef.current = null;
      setSaving(false);
    });
    capturePromiseRef.current = promise;
    return promise;
  }, [client, documentId, editor, session]);

  const scheduleAutomaticVersion = useCallback(() => {
    if (session.role !== "editor") return;
    if (timerRef.current) clearTimeout(timerRef.current);
    const runCapture = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (maximumTimerRef.current) clearTimeout(maximumTimerRef.current);
      timerRef.current = null;
      maximumTimerRef.current = null;
      if (!dirtyRef.current) return;
      void captureVersion("automatic").then(() => {
        if (dirtyRef.current) scheduleAutomaticVersion();
      });
    };
    const delay = automaticVersionDelay(latestCreatedAtRef.current);
    timerRef.current = setTimeout(runCapture, delay);
    if (!maximumTimerRef.current) {
      maximumTimerRef.current = setTimeout(
        runCapture,
        automaticVersionMaximumDelay(latestCreatedAtRef.current),
      );
    }
  }, [captureVersion, session.role]);

  useEffect(() => {
    if (!networkReady) return;
    let active = true;
    void refreshVersions().then((loaded) => {
      if (!active || session.role !== "editor") return;
      const latest = loaded[0];
      if (!latest || latest.markdown_snapshot !== editor.getMarkdown()) {
        void captureVersion("automatic").then(() => {
          if (dirtyRef.current) scheduleAutomaticVersion();
        });
      }
    });
    return () => { active = false; };
  }, [captureVersion, editor, networkReady, refreshVersions, scheduleAutomaticVersion, session.role]);

  useEffect(() => {
    if (!networkReady || session.role !== "editor") return;
    const handleUpdate = () => {
      changeRevisionRef.current += 1;
      dirtyRef.current = true;
      scheduleAutomaticVersion();
    };
    editor.on("update", handleUpdate);
    return () => { editor.off("update", handleUpdate); };
  }, [editor, networkReady, scheduleAutomaticVersion, session.role]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (maximumTimerRef.current) clearTimeout(maximumTimerRef.current);
  }, []);

  const selected = versions.find((version) => version.id === selectedId) ?? null;

  const restoreSelected = async () => {
    if (!selected || session.role !== "editor") return;
    setRestoring(true);
    setError(null);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (maximumTimerRef.current) {
      clearTimeout(maximumTimerRef.current);
      maximumTimerRef.current = null;
    }
    try {
      const backup = await captureVersion("restore_backup");
      if (!backup) return;
      editor.commands.setContent(selected.markdown_snapshot, { contentType: "markdown" });
      await session.flush();
      const restored = await captureVersion("restore", selected.id);
      if (!restored) return;
      await refreshVersions();
    } finally {
      setRestoring(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      setOpen(nextOpen);
      if (nextOpen) void refreshVersions();
    }}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          className={error ? "text-destructive" : undefined}
          title={error ?? (saving ? "Saving version…" : "Version history")}
        >
          <History />
          History
        </Button>
      </DialogTrigger>
      <DialogContent className="h-[min(720px,calc(100svh-2rem))] max-w-4xl grid-rows-[auto_minmax(0,1fr)_auto]">
        <DialogHeader>
          <DialogTitle>Version history</DialogTitle>
          <DialogDescription>
            Ghost saves an initial version, then groups active editing into automatic versions.
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 grid-cols-[230px_minmax(0,1fr)] overflow-hidden rounded-md border border-border">
          <div className="overflow-auto border-r border-border bg-muted/20 p-2">
            {loading && versions.length === 0 ? (
              <p className="px-2 py-3 text-xs text-muted-foreground">Loading history…</p>
            ) : versions.length === 0 ? (
              <p className="px-2 py-3 text-xs text-muted-foreground">No versions yet.</p>
            ) : versions.map((version) => (
              <button
                key={version.id}
                type="button"
                onClick={() => setSelectedId(version.id)}
                className={`mb-1 w-full rounded-md px-2 py-2 text-left text-xs transition-colors ${
                  selectedId === version.id ? "bg-accent text-accent-foreground" : "hover:bg-accent/60"
                }`}
              >
                <span className="block font-medium">{formatVersionTime(version.created_at)}</span>
                <span className="mt-0.5 block text-muted-foreground">
                  {formatCloudVersionReason(version.reason)}
                </span>
              </button>
            ))}
          </div>
          <div className="min-h-0 overflow-auto bg-background p-5">
            {selected ? (
              <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-foreground">
                {selected.markdown_snapshot || "(Empty document)"}
              </pre>
            ) : (
              <p className="text-sm text-muted-foreground">Select a version to preview it.</p>
            )}
          </div>
        </div>
        <DialogFooter className="items-center sm:justify-between">
          <div className="min-h-5 text-xs text-muted-foreground">
            {error ? <span className="text-destructive">{error}</span> : saving ? "Saving version…" : null}
          </div>
          <Button
            type="button"
            disabled={!selected || session.role !== "editor" || restoring || saving}
            onClick={() => void restoreSelected()}
          >
            <RotateCcw />
            {restoring ? "Restoring…" : "Restore this version"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
