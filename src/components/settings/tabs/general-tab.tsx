import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import type { Settings } from "@/hooks/use-settings";
import type { UpdateInfo } from "@/hooks/use-updater";
import { SettingRow } from "@/components/settings/setting-row";
import { Button } from "@/components/ui/button";
import { RefreshCw, Check, AlertCircle } from "lucide-react";

interface GeneralTabProps {
  settings: Settings;
  onUpdateSettings: (updates: Partial<Settings>) => void;
  updater: UpdateInfo;
}

export function GeneralTab({ settings, onUpdateSettings, updater }: GeneralTabProps) {
  const [appVersion, setAppVersion] = useState<string>("");

  useEffect(() => {
    getVersion().then(setAppVersion);
  }, []);

  const { state, version: updateVersion, error, checkForUpdate, installUpdate } = updater;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card p-6 space-y-4">
        <SettingRow
          label="Show all files"
          description="Display all file types in the sidebar, not just .md"
        >
          <button
            role="switch"
            aria-checked={settings.showAllFiles}
            onClick={() =>
              onUpdateSettings({ showAllFiles: !settings.showAllFiles })
            }
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
              settings.showAllFiles ? "bg-primary" : "bg-input"
            }`}
          >
            <span
              className={`pointer-events-none inline-block size-4 transform rounded-full bg-background shadow-lg ring-0 transition-transform ${
                settings.showAllFiles ? "translate-x-4" : "translate-x-0"
              }`}
            />
          </button>
        </SettingRow>
      </div>

      <div className="rounded-xl border bg-card p-6 space-y-4">
        <SettingRow
          label="Updates"
          description={`Ghost v${appVersion}`}
        >
          <div className="flex items-center gap-3">
            {state === "idle" || state === "up-to-date" || state === "error" ? (
              <Button
                size="sm"
                variant="outline"
                onClick={checkForUpdate}
              >
                Check for Updates
              </Button>
            ) : state === "checking" ? (
              <Button size="sm" variant="outline" disabled>
                <RefreshCw className="size-3.5 animate-spin" />
                Checking...
              </Button>
            ) : state === "available" ? (
              <Button size="sm" onClick={installUpdate}>
                Install v{updateVersion}
              </Button>
            ) : state === "downloading" ? (
              <Button size="sm" disabled>
                <RefreshCw className="size-3.5 animate-spin" />
                Downloading...
              </Button>
            ) : state === "installing" ? (
              <Button size="sm" disabled>
                <RefreshCw className="size-3.5 animate-spin" />
                Installing...
              </Button>
            ) : null}

            {state === "up-to-date" && (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Check className="size-3.5" />
                Up to date
              </span>
            )}

            {state === "error" && (
              <span className="flex items-center gap-1.5 text-xs text-destructive">
                <AlertCircle className="size-3.5" />
                {error ?? "Update check failed"}
              </span>
            )}
          </div>
        </SettingRow>
      </div>
    </div>
  );
}
