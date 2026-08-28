import { useEffect, useRef, useState, type ReactNode } from "react";
import { Input } from "@/components/ui/input";

export function DocumentHeader({
  pathSegments = [],
  fileName,
  onRename,
  right,
  search,
  sidebarCollapsed = false,
}: {
  pathSegments?: string[];
  fileName: string | null;
  onRename?: (nextName: string) => void | Promise<void>;
  right?: ReactNode;
  search?: ReactNode;
  sidebarCollapsed?: boolean;
}) {
  const [renaming, setRenaming] = useState(false);
  const [renameName, setRenameName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const beginRename = () => {
    if (!fileName || !onRename) return;
    setRenameName(fileName);
    setRenaming(true);
  };

  useEffect(() => {
    if (!renaming || !inputRef.current) return;
    inputRef.current.focus();
    const dotIndex = renameName.lastIndexOf(".");
    if (dotIndex > 0) inputRef.current.setSelectionRange(0, dotIndex);
    else inputRef.current.select();
  }, [renaming]);

  const finishRename = async () => {
    const nextName = renameName.trim();
    if (!fileName || !nextName || nextName === fileName || !onRename) {
      setRenaming(false);
      return;
    }
    try {
      await onRename(nextName);
      setRenaming(false);
    } catch (reason) {
      console.error("Failed to rename document:", reason);
      inputRef.current?.focus();
    }
  };

  return (
    <div
      className={`absolute left-0 right-0 top-0 z-10 flex h-12 items-center justify-between bg-background/80 backdrop-blur-sm ${
        sidebarCollapsed ? "pl-[100px] pr-8" : "px-8"
      }`}
      data-document-header
      data-tauri-drag-region
    >
      {search ?? (
        <>
          <div className="pointer-events-none flex min-w-0 flex-1 items-center text-[13px]">
            {renaming ? (
              <Input
                ref={inputRef}
                value={renameName}
                onChange={(event) => setRenameName(event.target.value)}
                onBlur={() => void finishRename()}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void finishRename();
                  if (event.key === "Escape") setRenaming(false);
                }}
                className="pointer-events-auto h-6 w-48 bg-transparent px-1 text-[13px]"
                aria-label="Document name"
              />
            ) : fileName ? (
              <div className="flex min-w-0 items-center overflow-hidden">
                {pathSegments.length > 0 ? (
                  <>
                    <span
                      className="pointer-events-none select-none truncate text-muted-foreground"
                      style={{ flexShrink: 10 }}
                    >
                      {pathSegments.join(" / ")}
                    </span>
                    <span className="pointer-events-none mx-1 shrink-0 select-none text-ring">/</span>
                  </>
                ) : null}
                <span
                  className={`pointer-events-auto truncate font-medium text-sidebar-primary transition-colors ${
                    onRename ? "cursor-pointer hover:text-sidebar-foreground" : ""
                  }`}
                  style={{ flexShrink: 1 }}
                  onClick={beginRename}
                >
                  {fileName}
                </span>
              </div>
            ) : null}
          </div>
          {right ? <div className="flex items-center gap-3">{right}</div> : null}
        </>
      )}
    </div>
  );
}
