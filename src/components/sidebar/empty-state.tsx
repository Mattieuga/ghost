import { Button } from "@/components/ui/button";
import { FolderPlus } from "lucide-react";

interface EmptyStateProps {
  onAddFolder: () => void;
}

export function EmptyState({ onAddFolder }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-4 py-8 text-center">
      <FolderPlus className="size-8 text-muted-foreground" />
      <div>
        <p className="text-sm font-medium">No folders tracked</p>
        <p className="text-xs text-muted-foreground mt-1">
          Add a folder to start editing
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={onAddFolder}>
        Add Folder
      </Button>
    </div>
  );
}
