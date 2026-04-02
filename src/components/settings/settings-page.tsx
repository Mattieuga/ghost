import { useState, useEffect } from "react";
import { Settings2, Type, Palette } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Settings } from "@/hooks/use-settings";
import type { ThemePreset } from "@/lib/theme-engine";
import { GeneralTab } from "@/components/settings/tabs/general-tab";
import { EditorTab } from "@/components/settings/tabs/editor-tab";
import { ThemesTab } from "@/components/settings/tabs/themes-tab";
import type { LucideIcon } from "lucide-react";

type SettingsTab = "general" | "editor" | "themes";

const tabs: { id: SettingsTab; label: string; icon: LucideIcon }[] = [
  { id: "general", label: "General", icon: Settings2 },
  { id: "editor", label: "Editor", icon: Type },
  { id: "themes", label: "Themes", icon: Palette },
];

interface SettingsPageProps {
  settings: Settings;
  onUpdateSettings: (updates: Partial<Settings>) => void;
  onClose: () => void;
  customThemes: ThemePreset[];
  onSaveTheme: (preset: ThemePreset) => void;
  onDeleteTheme: (id: string) => void;
}

export function SettingsPage({
  settings,
  onUpdateSettings,
  onClose,
  customThemes,
  onSaveTheme,
  onDeleteTheme,
}: SettingsPageProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/60 animate-in fade-in-0 duration-150"
        onClick={onClose}
      />

      {/* Floating panel */}
      <div
        className="fixed left-1/2 z-50 -translate-x-1/2 animate-in fade-in-0 zoom-in-95 duration-150"
        style={{ top: "12%", width: 520 }}
      >
        <div
          className="rounded-xl border border-border bg-popover shadow-2xl overflow-hidden flex flex-col"
          style={{ maxHeight: "72vh" }}
        >
          {/* Header: title + tab bar */}
          <div className="px-5 pt-5 pb-3 border-b border-border shrink-0">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold">Settings</h2>
              <kbd className="text-[11px] font-medium text-ring select-none">esc</kbd>
            </div>

            {/* Tab bar */}
            <div className="flex items-center gap-1">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer",
                    activeTab === tab.id
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                  )}
                >
                  <tab.icon className="size-3.5" />
                  <span>{tab.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Tab content */}
          <div className="overflow-y-auto p-5">
            {activeTab === "general" && (
              <GeneralTab
                settings={settings}
                onUpdateSettings={onUpdateSettings}
              />
            )}
            {activeTab === "editor" && (
              <EditorTab
                settings={settings}
                onUpdateSettings={onUpdateSettings}
              />
            )}
            {activeTab === "themes" && (
              <ThemesTab
                settings={settings}
                onUpdateSettings={onUpdateSettings}
                customThemes={customThemes}
                onSaveTheme={onSaveTheme}
                onDeleteTheme={onDeleteTheme}
              />
            )}
          </div>
        </div>
      </div>
    </>
  );
}
