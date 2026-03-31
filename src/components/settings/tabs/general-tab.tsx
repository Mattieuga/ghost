import { Separator } from "@/components/ui/separator";
import type { Settings } from "@/hooks/use-settings";

interface GeneralTabProps {
  settings: Settings;
  onUpdateSettings: (updates: Partial<Settings>) => void;
}

export function GeneralTab({ settings, onUpdateSettings }: GeneralTabProps) {
  return (
    <div className="rounded-xl border bg-card p-6 space-y-4">
      <SettingRow label="Theme" description="Choose light, dark, or follow system">
        <select
          value={settings.theme}
          onChange={(e) =>
            onUpdateSettings({ theme: e.target.value as Settings["theme"] })
          }
          className="h-8 rounded-md border bg-background px-3 text-sm"
        >
          <option value="system">System</option>
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
      </SettingRow>

      <Separator />

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

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  );
}
