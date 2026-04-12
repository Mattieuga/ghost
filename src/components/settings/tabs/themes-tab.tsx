import { useEffect, useRef, useState } from "react";
import type { Settings } from "@/hooks/use-settings";
import type { ThemeColors, ThemePreset } from "@/lib/theme-engine";
import { BUILTIN_THEMES } from "@/lib/theme-engine";
import { ThemeCard } from "@/components/settings/theme-card";
import { ColorPicker } from "@/components/settings/color-picker";

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
  const [activePicker, setActivePicker] = useState<keyof ThemeColors | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

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

  // Close picker on outside click
  useEffect(() => {
    if (!activePicker) return;
    const handleClick = (e: MouseEvent) => {
      if (pickerRef.current && e.target instanceof Node && !pickerRef.current.contains(e.target)) {
        setActivePicker(null);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [activePicker]);

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
            <div key={key} className="relative" ref={activePicker === key ? pickerRef : undefined}>
              <button
                className="flex flex-col items-center gap-1 cursor-pointer"
                onClick={() => setActivePicker(activePicker === key ? null : key)}
              >
                <div
                  className="size-8 rounded-full border-2 border-border hover:border-ring transition-colors"
                  style={{ background: settings.themeColors[key] }}
                />
                <span className="text-[10px] text-muted-foreground">{label}</span>
              </button>
              {activePicker === key && (
                <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 z-50">
                  <ColorPicker
                    color={settings.themeColors[key]}
                    onChange={(hex) => updateColor(key, hex)}
                  />
                </div>
              )}
            </div>
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
