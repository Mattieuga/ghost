import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

/** One entry in the history list, from local history or Cloud. */
export interface HistoryVersion {
  id: string;
  createdAt: string;
  reason: "automatic" | "restore" | "restore_backup" | "external_write";
  source: "local" | "cloud";
  markdown: string;
}

const REASON_LABELS: Record<HistoryVersion["reason"], string> = {
  automatic: "Edited",
  restore: "Restored",
  restore_backup: "Before a restore",
  external_write: "Changed outside Ghost",
};

function dayOf(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(timestamp));
}

function timeOf(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(new Date(timestamp));
}

/**
 * Drop entries whose text equals the one just before them in time, so a
 * version captured twice, once locally and once in Cloud, is listed once.
 */
export function dedupeVersions(versions: HistoryVersion[]): HistoryVersion[] {
  const sorted = [...versions].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  const kept: HistoryVersion[] = [];
  for (const version of sorted) {
    const previous = kept[kept.length - 1];
    if (previous && previous.markdown === version.markdown) {
      // Keep the earlier of the pair, which is when the text first existed.
      kept[kept.length - 1] = version.reason === "automatic" || previous.reason === "automatic" ? { ...version, reason: previous.reason === "automatic" ? version.reason : previous.reason } : version;
      continue;
    }
    kept.push(version);
  }
  return kept;
}

/**
 * The history panel beside the editor. Picking a version shows it in the
 * editor with what it changed marked, and Restore makes it the current
 * text. Nothing here writes until Restore.
 */
export function VersionHistorySidebar({
  versions,
  loading,
  error,
  selectedId,
  onSelect,
  onRestore,
  onClose,
  canRestore,
  restoring,
}: {
  versions: HistoryVersion[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onRestore: (version: HistoryVersion) => void;
  onClose: () => void;
  canRestore: boolean;
  restoring: boolean;
}) {
  const selected = versions.find((version) => version.id === selectedId) ?? null;
  const groups: Array<{ day: string; versions: HistoryVersion[] }> = [];
  for (const version of versions) {
    const day = dayOf(version.createdAt);
    const group = groups[groups.length - 1];
    if (group && group.day === day) group.versions.push(version);
    else groups.push({ day, versions: [version] });
  }

  return (
    <aside
      data-version-history
      className="flex h-full w-72 shrink-0 flex-col border-l border-border bg-sidebar text-sm"
      aria-label="Version history"
    >
      <div className="flex items-center justify-between px-4 pb-2 pt-3">
        <span className="text-[10px] font-medium uppercase text-ring" style={{ letterSpacing: "1.2px" }}>History</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close history"
          className="cursor-pointer text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {loading && versions.length === 0 ? (
          <p className="px-2 py-2 text-xs text-ring">Loading history…</p>
        ) : versions.length === 0 ? (
          <p className="px-2 py-2 text-xs text-ring">No versions yet. Ghost saves one as you edit.</p>
        ) : groups.map((group) => (
          <div key={group.day} className="mb-2">
            <p className="px-2 py-1 text-[11px] font-medium text-ring">{group.day}</p>
            {group.versions.map((version) => {
              const active = version.id === selectedId;
              return (
                <button
                  key={version.id}
                  type="button"
                  data-version-row
                  aria-pressed={active}
                  onClick={() => onSelect(active ? null : version.id)}
                  className={`flex w-full cursor-pointer flex-col rounded-md px-2 py-1.5 text-left transition-colors ${
                    active ? "bg-white/[0.06] text-card-foreground" : "text-sidebar-primary hover:bg-sidebar-accent/70"
                  }`}
                >
                  <span className="text-[13px]">{timeOf(version.createdAt)}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {REASON_LABELS[version.reason]}{version.source === "local" ? " · on this Mac" : ""}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div className="space-y-2 border-t border-border px-4 py-3">
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span><span data-diff="insert" className="rounded px-1">added</span></span>
          <span><span data-diff="delete" className="rounded px-1">removed</span></span>
        </div>
        <Button
          size="sm"
          className="w-full"
          disabled={!selected || !canRestore || restoring}
          onClick={() => { if (selected) onRestore(selected); }}
        >
          {restoring ? "Restoring…" : "Restore this version"}
        </Button>
        {error ? <p className="text-xs text-destructive" role="alert">{error}</p> : null}
      </div>
    </aside>
  );
}
