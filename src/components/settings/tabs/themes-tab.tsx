import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import type { Settings } from "@/hooks/use-settings";
import type { ThemeColors, ThemePreset } from "@/lib/theme-engine";
import { BUILTIN_THEMES, SYNTAX_PALETTE_OPTIONS, getSyntaxPaletteColors } from "@/lib/theme-engine";
import { ThemeCard } from "@/components/settings/theme-card";
import { ColorPicker } from "@/components/settings/color-picker";
import { ChevronDown, Check } from "lucide-react";

interface ThemesTabProps {
  settings: Settings;
  onUpdateSettings: (updates: Partial<Settings>) => void;
  customThemes: ThemePreset[];
  onSaveTheme: (preset: ThemePreset) => void;
  onDeleteTheme: (id: string) => void;
  compact?: boolean;
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
  compact,
}: ThemesTabProps) {
  const [saving, setSaving] = useState(false);
  const [themeName, setThemeName] = useState("");
  const [activePicker, setActivePicker] = useState<keyof ThemeColors | null>(null);
  const [pickerPos, setPickerPos] = useState<{ top: number; left: number } | null>(null);
  const [syntaxDropdownOpen, setSyntaxDropdownOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const syntaxRef = useRef<HTMLDivElement>(null);
  const syntaxListRef = useRef<HTMLDivElement>(null);

  const openPicker = useCallback((key: keyof ThemeColors, button: HTMLElement) => {
    if (activePicker === key) {
      setActivePicker(null);
      setPickerPos(null);
      return;
    }
    const rect = button.getBoundingClientRect();
    setPickerPos({ top: rect.bottom + 8, left: rect.left + rect.width / 2 });
    setActivePicker(key);
  }, [activePicker]);

  const selectPreset = (preset: ThemePreset) => {
    const { id, label, syntaxPalette, ...colors } = preset;
    onUpdateSettings({ theme: id, themeColors: colors, syntaxPalette });
  };

  const updateColor = (key: keyof ThemeColors, value: string) => {
    onUpdateSettings({
      theme: settings.theme.startsWith("custom-") ? settings.theme : "custom",
      themeColors: { ...settings.themeColors, [key]: value },
    });
  };

  // Close picker / syntax dropdown on outside click
  useEffect(() => {
    if (!activePicker && !syntaxDropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (activePicker && pickerRef.current && e.target instanceof Node && !pickerRef.current.contains(e.target)) {
        setActivePicker(null);
        setPickerPos(null);
      }
      if (syntaxDropdownOpen && syntaxRef.current && e.target instanceof Node && !syntaxRef.current.contains(e.target)) {
        setSyntaxDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [activePicker, syntaxDropdownOpen]);

  // Scroll active palette into view when dropdown opens
  useEffect(() => {
    if (syntaxDropdownOpen && syntaxListRef.current) {
      const active = syntaxListRef.current.querySelector("[data-active]") as HTMLElement | null;
      if (active) {
        const list = syntaxListRef.current;
        const top = active.offsetTop - list.offsetTop - list.clientHeight / 2 + active.clientHeight / 2;
        list.scrollTop = Math.max(0, top);
      }
    }
  }, [syntaxDropdownOpen]);

  const activeCustomTheme = customThemes.find((t) => t.id === settings.theme);

  const handleSave = () => {
    if (!themeName.trim()) return;
    const id = `custom-${crypto.randomUUID()}`;
    onSaveTheme({
      id,
      label: themeName.trim(),
      syntaxPalette: settings.syntaxPalette,
      ...settings.themeColors,
    });
    onUpdateSettings({ theme: id });
    setThemeName("");
    setSaving(false);
  };

  const handleUpdate = () => {
    if (!activeCustomTheme) return;
    onSaveTheme({
      ...activeCustomTheme,
      syntaxPalette: settings.syntaxPalette,
      ...settings.themeColors,
    });
  };

  return (
    <div className="space-y-5">
      {/* Color editor */}
      <div className={compact ? "space-y-3" : "flex items-end gap-3"}>
        <div className={compact ? "flex items-center gap-2 flex-wrap" : "flex items-center gap-3 flex-1"}>
          {COLOR_SWATCHES.map(({ key, label }) => (
            <div key={key}>
              <button
                className="flex flex-col items-center gap-1 cursor-pointer"
                onClick={(e) => openPicker(key, e.currentTarget)}
              >
                <div
                  className="size-8 rounded-full border-2 border-border hover:border-ring transition-colors"
                  style={{ background: settings.themeColors[key] }}
                />
                <span className="text-[10px] text-muted-foreground">{label}</span>
              </button>
            </div>
          ))}
          {activePicker && pickerPos && createPortal(
            <div
              ref={pickerRef}
              className="fixed z-[100]"
              style={{ top: pickerPos.top, left: pickerPos.left, transform: "translateX(-50%)" }}
            >
              <ColorPicker
                color={settings.themeColors[activePicker]}
                onChange={(hex) => updateColor(activePicker, hex)}
              />
            </div>,
            document.body,
          )}

          {/* Syntax palette picker */}
          <div className="relative" ref={syntaxRef}>
            <button
              className="flex flex-col items-center gap-1 cursor-pointer"
              onClick={() => { setSyntaxDropdownOpen(!syntaxDropdownOpen); setActivePicker(null); }}
            >
              <div
                className="size-8 flex items-center justify-center rounded-full border-2 border-border hover:border-ring transition-colors"
                style={{
                  background: `conic-gradient(${getSyntaxPaletteColors(settings.syntaxPalette ?? settings.theme)
                    .map((c, i, a) => `${c} ${(i / a.length) * 100}% ${((i + 1) / a.length) * 100}%`)
                    .join(", ")})`,
                }}
              >
                <ChevronDown className="size-3 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]" />
              </div>
              <span className="text-[10px] text-muted-foreground">Syntax</span>
            </button>
            {syntaxDropdownOpen && (
              <div ref={syntaxListRef} className="absolute top-full left-1/2 -translate-x-1/2 mt-2 z-50 w-44 max-h-[17rem] overflow-y-auto overscroll-contain rounded-lg border border-border bg-popover p-1 shadow-lg">
                <button
                  data-active={!settings.syntaxPalette ? "" : undefined}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-popover-foreground hover:bg-accent cursor-pointer"
                  onClick={() => { onUpdateSettings({ syntaxPalette: undefined }); setSyntaxDropdownOpen(false); }}
                >
                  <Check className={`size-3 ${!settings.syntaxPalette ? "opacity-100" : "opacity-0"}`} />
                  Auto
                </button>
                {SYNTAX_PALETTE_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    data-active={settings.syntaxPalette === opt.id ? "" : undefined}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-popover-foreground hover:bg-accent cursor-pointer"
                    onClick={() => { onUpdateSettings({ syntaxPalette: opt.id }); setSyntaxDropdownOpen(false); }}
                  >
                    <Check className={`size-3 ${settings.syntaxPalette === opt.id ? "opacity-100" : "opacity-0"}`} />
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Save / Update theme buttons */}
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
          <div className="flex items-center gap-1.5">
            {activeCustomTheme && (
              <button
                onClick={handleUpdate}
                className="h-7 px-3 rounded-md bg-ghost-amber text-xs font-medium text-background cursor-pointer whitespace-nowrap"
              >
                Update
              </button>
            )}
            <button
              onClick={() => setSaving(true)}
              className="h-7 px-3 rounded-md border border-border hover:border-ring text-xs text-muted-foreground hover:text-card-foreground transition-colors cursor-pointer whitespace-nowrap"
            >
              Save As
            </button>
          </div>
        )}
      </div>

      {/* User-saved themes */}
      {customThemes.length > 0 && (
        <div>
          <h3 className="text-[10px] font-medium uppercase text-muted-foreground mb-2" style={{ letterSpacing: "1px" }}>
            My Themes
          </h3>
          <div className={compact ? "grid grid-cols-2 gap-2" : "grid grid-cols-3 gap-2.5"}>
            {[...customThemes].sort((a, b) => a.label.localeCompare(b.label)).map((theme) => (
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
        <div className={compact ? "grid grid-cols-2 gap-2" : "grid grid-cols-3 gap-2.5"}>
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
