import type { Settings } from "@/hooks/use-settings";
import { SettingRow } from "@/components/settings/setting-row";

interface GeneralTabProps {
  settings: Settings;
  onUpdateSettings: (updates: Partial<Settings>) => void;
}

export function GeneralTab({ settings, onUpdateSettings }: GeneralTabProps) {
  return (
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
  );
}
