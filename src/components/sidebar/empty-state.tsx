import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  onNewFile: () => void;
  onOpenFolder: () => void;
}

/** Shown only when the user has closed every folder. A fresh install seeds Notes instead. */
export function EmptyState({ onNewFile, onOpenFolder }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-4 py-8 text-center">
      <div>
        <p className="text-sm font-medium">Nothing open</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Start a note, or open any folder on your Mac.
        </p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onNewFile}>
          New File
        </Button>
        <Button variant="outline" size="sm" onClick={onOpenFolder}>
          Open Folder…
        </Button>
      </div>
    </div>
  );
}
