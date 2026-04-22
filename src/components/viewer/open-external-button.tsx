import { invoke } from "@tauri-apps/api/core";
import { ExternalLink } from "lucide-react";

interface OpenExternalButtonProps {
  filePath: string;
}

export function OpenExternalButton({ filePath }: OpenExternalButtonProps) {
  return (
    <button
      onClick={() => invoke("open_with_default_app", { path: filePath })}
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border hover:border-ring text-[11px] text-muted-foreground hover:text-card-foreground transition-colors cursor-pointer"
    >
      <ExternalLink className="size-3" />
      Open in Preview
    </button>
  );
}
