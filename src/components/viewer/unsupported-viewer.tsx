import { File } from "lucide-react";
import { OpenExternalButton } from "./open-external-button";

interface UnsupportedViewerProps {
  filePath: string;
}

export function UnsupportedViewer({ filePath }: UnsupportedViewerProps) {
  const fileName = filePath.split("/").pop() ?? filePath;
  const ext = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".")) : "";

  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 pt-12">
      <File className="size-16 text-ring" strokeWidth={1} />
      <div className="text-center">
        <div className="text-sm text-card-foreground font-medium">{fileName}</div>
        {ext && <div className="text-xs text-muted-foreground mt-1">{ext.toUpperCase()} file</div>}
      </div>
      <OpenExternalButton filePath={filePath} />
    </div>
  );
}
