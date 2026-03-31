import type { Settings } from "@/hooks/use-settings";
import { ThemeCard, THEME_PRESETS } from "@/components/settings/theme-card";

interface ThemesTabProps {
  settings: Settings;
  onUpdateSettings: (updates: Partial<Settings>) => void;
}

export function ThemesTab({ settings, onUpdateSettings }: ThemesTabProps) {
  return (
    <div className="grid grid-cols-2 gap-4">
      {THEME_PRESETS.map((preset) => (
        <ThemeCard
          key={preset.id}
          preset={preset}
          isActive={settings.theme === preset.id}
          onClick={() => onUpdateSettings({ theme: preset.id })}
        />
      ))}
    </div>
  );
}
