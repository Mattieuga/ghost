import { useEffect, useState } from "react";
import type { TrackedRoot } from "@/hooks/use-tracked-folders";
import { tauriMirrorFs, type MirrorFs } from "@/lib/mirror/mirror-fs";
import { prepareSync, type SyncPreparation } from "@/lib/mirror/sync-folder";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type DialogState =
  | { kind: "checking" }
  | { kind: "error"; message: string }
  | { kind: "ready"; preparation: SyncPreparation };

function folderName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1) || path;
}

/**
 * The "Sync to Cloud" confirmation. Runs pre-flight when opened. A refusal
 * explains itself and offers only Close. An allowed folder lists what will
 * be skipped and any warnings, then asks once.
 */
export function SyncFolderDialog({
  path,
  roots,
  onClose,
  onConfirm,
  fs = tauriMirrorFs,
}: {
  path: string | null;
  roots: TrackedRoot[];
  onClose: () => void;
  onConfirm: (path: string) => void | Promise<void>;
  fs?: MirrorFs;
}) {
  const [state, setState] = useState<DialogState>({ kind: "checking" });
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!path) return;
    let active = true;
    setState({ kind: "checking" });
    setConfirming(false);
    void prepareSync(fs, path, roots).then((preparation) => {
      if (active) setState({ kind: "ready", preparation });
    }).catch((reason: unknown) => {
      if (active) setState({ kind: "error", message: reason instanceof Error ? reason.message : String(reason) });
    });
    return () => { active = false; };
    // Roots change identity on every render of the layout; the check is per open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fs, path]);

  if (!path) return null;
  const name = folderName(path);
  const refusal = state.kind === "ready" ? state.preparation.result.refusal : null;
  const allowed = state.kind === "ready" && state.preparation.result.verdict === "allow";
  const preparation = state.kind === "ready" ? state.preparation : null;

  const confirm = async () => {
    setConfirming(true);
    try {
      await onConfirm(path);
    } finally {
      setConfirming(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !confirming) onClose(); }}>
      <DialogContent
        data-sync-folder-dialog
        onKeyDown={(event) => { if (event.key === "Enter" && allowed && !confirming) void confirm(); }}
      >
        <DialogHeader>
          <DialogTitle>{refusal ? `Can't sync ${name}` : `Sync ${name} to Cloud?`}</DialogTitle>
          <DialogDescription>
            {state.kind === "checking" ? `Looking at ${name}…` : null}
            {state.kind === "error" ? state.message : null}
            {refusal ? refusal.message : null}
            {allowed
              ? `${name} keeps living where it is. Ghost will keep its notes up to date on your phone and let you share them. ${describeCounts(preparation)}`
              : null}
          </DialogDescription>
        </DialogHeader>

        {allowed && preparation ? (
          <div className="space-y-3 text-sm">
            {preparation.result.excluded.length > 0 ? (
              <div>
                <p className="text-muted-foreground">
                  {preparation.result.excluded.length === 1
                    ? "One folder inside will be skipped:"
                    : `${preparation.result.excluded.length} folders inside will be skipped:`}
                </p>
                <ul className="mt-1 max-h-32 overflow-auto pl-4 text-muted-foreground">
                  {preparation.result.excluded.map((item) => (
                    <li key={`${item.path}/${item.marker}`} className="list-disc">
                      {folderName(item.path)}
                      <span className="text-ring"> ({item.reason === "version-control" ? "version control" : "managed by another app"})</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {preparation.result.warnings.map((warning) => (
              <p key={warning.code} role="note" className="text-ghost-amber">
                {warning.message}
              </p>
            ))}
          </div>
        ) : null}

        <DialogFooter>
          {allowed ? (
            <>
              <Button variant="outline" onClick={onClose} disabled={confirming}>Cancel</Button>
              <Button onClick={() => void confirm()} disabled={confirming}>
                {confirming ? "Syncing…" : "Sync"}
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={onClose}>Close</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function describeCounts(preparation: SyncPreparation | null): string {
  if (!preparation) return "";
  const notes = preparation.facts.markdownCount;
  return `${notes.toLocaleString()} ${notes === 1 ? "note" : "notes"} found.`;
}

/** The "Stop syncing" confirmation. Files stay; only Ghost's metadata goes. */
export function StopSyncingDialog({
  root,
  onClose,
  onConfirm,
}: {
  root: TrackedRoot | null;
  onClose: () => void;
  onConfirm: (root: TrackedRoot) => void | Promise<void>;
}) {
  const [working, setWorking] = useState(false);
  if (!root) return null;
  const name = folderName(root.path);
  const confirm = async () => {
    setWorking(true);
    try {
      await onConfirm(root);
    } finally {
      setWorking(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !working) onClose(); }}>
      <DialogContent data-stop-syncing-dialog onKeyDown={(event) => { if (event.key === "Enter" && !working) void confirm(); }}>
        <DialogHeader>
          <DialogTitle>Stop syncing {name}?</DialogTitle>
          <DialogDescription>
            The files stay on this Mac as plain Markdown. {name} will no longer appear on
            your phone. If you are signed in, its Cloud copy moves to Cloud Trash and anyone
            you shared it with loses access.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={working}>Cancel</Button>
          <Button variant="destructive" onClick={() => void confirm()} disabled={working}>
            {working ? "Stopping…" : "Stop Syncing"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
