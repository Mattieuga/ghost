import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import type { Settings } from "@/hooks/use-settings";
import type { UpdateInfo } from "@/hooks/use-updater";
import { SettingRow, SettingSwitch } from "@/components/settings/setting-row";
import { Button } from "@/components/ui/button";
import { RefreshCw, Check, AlertCircle } from "lucide-react";

interface GeneralTabProps {
  settings: Settings;
  onUpdateSettings: (updates: Partial<Settings>) => void;
  updater: UpdateInfo;
}

export function GeneralTab({ settings, onUpdateSettings, updater }: GeneralTabProps) {
  const [appVersion, setAppVersion] = useState<string>("");
  const [showUpToDate, setShowUpToDate] = useState(false);

  useEffect(() => {
    getVersion().then(setAppVersion);
  }, []);

  const { state, version: updateVersion, error, checkForUpdate, installUpdate } = updater;

  useEffect(() => {
    if (state === "up-to-date") {
      setShowUpToDate(true);
      const t = setTimeout(() => setShowUpToDate(false), 3000);
      return () => clearTimeout(t);
    }
  }, [state]);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card p-6 space-y-4">
        <SettingRow
          label="Show all files"
          description="Display all file types in the sidebar, not just .md"
        >
          <SettingSwitch
            label="Show all files"
            checked={settings.showAllFiles}
            onChange={(checked) => onUpdateSettings({ showAllFiles: checked })}
          />
        </SettingRow>
        <SettingRow
          label="Show hidden files"
          description="Display dotfiles and hidden folders; dependency, build, and VCS internals remain excluded"
        >
          <SettingSwitch
            label="Show hidden files"
            checked={settings.showHiddenFiles}
            onChange={(checked) => onUpdateSettings({ showHiddenFiles: checked })}
          />
        </SettingRow>
      </div>

      <div className="rounded-xl border bg-card p-6 space-y-4">
        <SettingRow
          label="Updates"
          description={`Ghost v${appVersion}`}
        >
          <div className="flex items-center gap-3">
            {state === "checking" ? (
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
            ) : showUpToDate ? (
              <Button size="sm" variant="outline" disabled>
                <Check className="size-3.5" />
                Up to date
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={checkForUpdate}
              >
                Check for Updates
              </Button>
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
