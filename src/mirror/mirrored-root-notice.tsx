import type { RootResolution } from "@/lib/mirror/root-resolution";

function folderName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1) || path;
}

/**
 * The one-line row a mirrored root shows instead of its tree when it cannot
 * be used: paused with a reason, unavailable until its volume returns, or
 * missing with Locate. Nothing here deletes anything.
 */
export function MirroredRootNotice({
  resolution,
  onLocate,
  onStopSyncing,
}: {
  resolution: Exclude<RootResolution, { kind: "ok" }>;
  onLocate: () => void;
  onStopSyncing: () => void;
}) {
  const name = folderName(resolution.path);
  const action = "text-ring hover:text-foreground";
  if (resolution.kind === "unavailable") {
    return (
      <div
        data-mirrored-root-notice="unavailable"
        className="flex items-center gap-2 px-4 py-1 text-xs text-ring/65"
        title={`${resolution.path} is on a volume that is not mounted.`}
      >
        <span className="min-w-0 flex-1 truncate">{name}</span>
        <span>Unavailable</span>
      </div>
    );
  }
  if (resolution.kind === "paused") {
    return (
      <div
        data-mirrored-root-notice="paused"
        className="flex items-center gap-2 px-4 py-1 text-xs text-ring"
        title={resolution.reason}
      >
        <span className="min-w-0 flex-1 truncate">{name}</span>
        <span className="text-ghost-amber">Paused</span>
        <button type="button" className={action} onClick={onStopSyncing}>Stop syncing</button>
      </div>
    );
  }
  return (
    <div
      data-mirrored-root-notice="missing"
      className="flex items-center gap-2 px-4 py-1 text-xs text-ring"
      title={`Ghost can't find ${resolution.path}. Its Cloud copy is untouched.`}
    >
      <span className="min-w-0 flex-1 truncate">Can't find {name}</span>
      <button type="button" className={action} onClick={onLocate}>Locate…</button>
      <button type="button" className={action} onClick={onStopSyncing}>Stop syncing</button>
    </div>
  );
}
