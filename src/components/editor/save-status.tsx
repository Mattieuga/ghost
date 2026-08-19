import type { DocumentSaveError, DocumentSaveStatus } from "@/hooks/use-document-save";

interface SaveStatusProps {
  status: DocumentSaveStatus;
  error: DocumentSaveError | null;
  onRetry: (force?: boolean) => Promise<void>;
}

export function SaveStatus({ status, error, onRetry }: SaveStatusProps) {
  if (status === "saving") {
    return <span className="text-[11px] text-ring">Saving…</span>;
  }

  if (status === "error" && error) {
    return (
      <span className="flex items-center gap-2 text-[11px] text-destructive" title={error.message}>
        <span>{error.kind === "conflict" ? "Changed on disk" : "Save failed"}</span>
        <button
          type="button"
          className="pointer-events-auto underline underline-offset-2 hover:text-foreground"
          onClick={() => void onRetry(error.kind === "conflict")}
        >
          {error.kind === "conflict" ? "Overwrite" : "Retry"}
        </button>
      </span>
    );
  }

  return <span className="text-[11px] text-ring/65">Saved</span>;
}
