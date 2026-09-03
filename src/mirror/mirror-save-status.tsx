import type { MirrorWriteStatus } from "@/lib/mirror/mirror-writer";

/** Header label for a mirrored document. Same words as the local and cloud labels. */
export function MirrorSaveStatus({
  status,
  error,
}: {
  status: MirrorWriteStatus;
  error: string | null;
}) {
  if (status === "error") {
    return (
      <span className="text-[11px] text-destructive" title={error ?? undefined}>
        Save failed
      </span>
    );
  }
  if (status === "saved") {
    return <span className="text-[11px] text-ring/65">Saved</span>;
  }
  if (status === "conflict") {
    return <span className="text-[11px] text-ring" title="The file changed on disk; Ghost is merging it.">Merging…</span>;
  }
  return <span className="text-[11px] text-ring">Saving…</span>;
}
