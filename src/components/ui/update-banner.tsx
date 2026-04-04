import type { UpdateInfo } from "@/hooks/use-updater";
import { Button } from "@/components/ui/button";
import { Download, RefreshCw } from "lucide-react";

interface UpdateBannerProps {
  updater: UpdateInfo;
}

export function UpdateBanner({ updater }: UpdateBannerProps) {
  const { state, version, progress, error, dismissed, installUpdate, dismissUpdate } = updater;

  // Only show when there's something to display and not dismissed
  if (dismissed) return null;
  if (state !== "available" && state !== "downloading" && state !== "installing" && state !== "error") return null;

  const percent = progress.total
    ? Math.round((progress.downloaded / progress.total) * 100)
    : null;

  return (
    <div className="fixed top-2 left-1/2 z-40 -translate-x-1/2 animate-in slide-in-from-top fade-in duration-300">
      <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-2.5 shadow-lg">
        {state === "available" && (
          <>
            <Download className="size-4 text-muted-foreground" />
            <span className="text-sm">
              Ghost <span className="font-medium">{version}</span> is available
            </span>
            <Button size="xs" onClick={installUpdate}>
              Update Now
            </Button>
            <Button size="xs" variant="ghost" onClick={dismissUpdate}>
              Later
            </Button>
          </>
        )}

        {state === "downloading" && (
          <>
            <RefreshCw className="size-4 animate-spin text-muted-foreground" />
            <div className="flex items-center gap-3">
              <span className="text-sm">Downloading {version}...</span>
              {percent !== null && (
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-300"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground">{percent}%</span>
                </div>
              )}
            </div>
          </>
        )}

        {state === "installing" && (
          <>
            <RefreshCw className="size-4 animate-spin text-muted-foreground" />
            <span className="text-sm">Installing update... Restarting shortly.</span>
          </>
        )}

        {state === "error" && (
          <>
            <span className="text-sm text-destructive">{error ?? "Update failed"}</span>
            <Button size="xs" variant="ghost" onClick={dismissUpdate}>
              Dismiss
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
