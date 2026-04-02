import { useState } from "react";
import type { Settings } from "@/hooks/use-settings";
import type { ThemeColors, ThemePreset } from "@/lib/theme-engine";
import { BUILTIN_THEMES } from "@/lib/theme-engine";
import { ThemeCard } from "@/components/settings/theme-card";

interface ThemesTabProps {
  settings: Settings;
  onUpdateSettings: (updates: Partial<Settings>) => void;
  customThemes: ThemePreset[];
  onSaveTheme: (preset: ThemePreset) => void;
  onDeleteTheme: (id: string) => void;
}

const COLOR_SWATCHES: { key: keyof ThemeColors; label: string }[] = [
  { key: "editorBg", label: "Bg" },
  { key: "sidebarBg", label: "Sidebar" },
  { key: "text", label: "Text" },
  { key: "heading", label: "Heading" },
  { key: "accent", label: "Accent" },
];

export function ThemesTab({
  settings,
  onUpdateSettings,
  customThemes,
  onSaveTheme,
  onDeleteTheme,
}: ThemesTabProps) {
  const [saving, setSaving] = useState(false);
  const [themeName, setThemeName] = useState("");

  const selectPreset = (preset: ThemePreset) => {
    const { id, label, ...colors } = preset;
    onUpdateSettings({ theme: id, themeColors: colors });
  };

  const updateColor = (key: keyof ThemeColors, value: string) => {
    onUpdateSettings({
      theme: "custom",
      themeColors: { ...settings.themeColors, [key]: value },
    });
  };

  const handleSave = () => {
    if (!themeName.trim()) return;
    const id = `custom-${crypto.randomUUID()}`;
    onSaveTheme({
      id,
      label: themeName.trim(),
      ...settings.themeColors,
    });
    onUpdateSettings({ theme: id });
    setThemeName("");
    setSaving(false);
  };

  return (
    <div className="space-y-5">
      {/* Compact color editor */}
      <div className="flex items-end gap-3">
        <div className="flex items-center gap-3 flex-1">
          {COLOR_SWATCHES.map(({ key, label }) => (
            <label key={key} className="flex flex-col items-center gap-1 cursor-pointer">
              <div className="relative">
                <input
                  type="color"
                  value={settings.themeColors[key]}
                  onChange={(e) => updateColor(key, e.target.value)}
                  className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                />
                <div
                  className="size-8 rounded-full border-2 border-border hover:border-ring transition-colors"
                  style={{ background: settings.themeColors[key] }}
                />
              </div>
              <span className="text-[10px] text-muted-foreground">{label}</span>
            </label>
          ))}
        </div>

        {/* Save theme button */}
        {saving ? (
          <div className="flex items-center gap-1.5">
            <input
              autoFocus
              value={themeName}
              onChange={(e) => setThemeName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
                if (e.key === "Escape") { setSaving(false); setThemeName(""); }
              }}
              placeholder="Theme name..."
              className="h-7 w-28 rounded-md border border-border bg-transparent px-2 text-xs text-card-foreground outline-none focus:border-ring caret-ghost-amber"
            />
            <button
              onClick={handleSave}
              disabled={!themeName.trim()}
              className="h-7 px-2.5 rounded-md bg-ghost-amber text-xs font-medium text-background disabled:opacity-40 cursor-pointer"
            >
              Save
            </button>
          </div>
        ) : (
          <button
            onClick={() => setSaving(true)}
            className="h-7 px-3 rounded-md border border-border hover:border-ring text-xs text-muted-foreground hover:text-card-foreground transition-colors cursor-pointer whitespace-nowrap"
          >
            Save Theme
          </button>
        )}
      </div>

      {/* User-saved themes */}
      {customThemes.length > 0 && (
        <div>
          <h3 className="text-[10px] font-medium uppercase text-muted-foreground mb-2" style={{ letterSpacing: "1px" }}>
            My Themes
          </h3>
          <div className="grid grid-cols-3 gap-2.5">
            {customThemes.map((theme) => (
              <ThemeCard
                key={theme.id}
                label={theme.label}
                colors={theme}
                isActive={settings.theme === theme.id}
                onClick={() => selectPreset(theme)}
                onDelete={() => onDeleteTheme(theme.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Built-in themes */}
      <div>
        <h3 className="text-[10px] font-medium uppercase text-muted-foreground mb-2" style={{ letterSpacing: "1px" }}>
          Themes
        </h3>
        <div className="grid grid-cols-3 gap-2.5">
          {BUILTIN_THEMES.map((theme) => (
            <ThemeCard
              key={theme.id}
              label={theme.label}
              colors={theme}
              isActive={settings.theme === theme.id}
              onClick={() => selectPreset(theme)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
