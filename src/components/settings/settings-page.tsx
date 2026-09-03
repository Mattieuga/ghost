import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Settings2, Type, Palette, UserRound, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Settings } from "@/hooks/use-settings";
import type { ThemePreset } from "@/lib/theme-engine";
import type { UpdateInfo } from "@/hooks/use-updater";
import { GeneralTab } from "@/components/settings/tabs/general-tab";
import { EditorTab } from "@/components/settings/tabs/editor-tab";
import { ThemesTab } from "@/components/settings/tabs/themes-tab";
import { AccountTab, type AccountTabProps } from "@/components/settings/tabs/account-tab";
import { useCompactMode } from "@/hooks/use-compact-mode";
import type { LucideIcon } from "lucide-react";

type SettingsTab = "general" | "editor" | "themes" | "account";

const tabs: { id: SettingsTab; label: string; icon: LucideIcon }[] = [
  { id: "general", label: "General", icon: Settings2 },
  { id: "editor", label: "Editor", icon: Type },
  { id: "themes", label: "Themes", icon: Palette },
  { id: "account", label: "Account", icon: UserRound },
];

interface SettingsPageProps {
  settings: Settings;
  onUpdateSettings: (updates: Partial<Settings>) => void;
  onClose: () => void;
  customThemes: ThemePreset[];
  onSaveTheme: (preset: ThemePreset) => void;
  onDeleteTheme: (id: string) => void;
  updater: UpdateInfo;
  account?: AccountTabProps;
  initialTab?: SettingsTab;
}

export function SettingsPage({
  settings,
  onUpdateSettings,
  onClose,
  customThemes,
  onSaveTheme,
  onDeleteTheme,
  updater,
  account,
  initialTab = "general",
}: SettingsPageProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const compact = useCompactMode();

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

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/60 animate-in fade-in-0 duration-150"
        onClick={onClose}
      />

      {/* Floating panel */}
      <div
        className="fixed left-1/2 z-50 -translate-x-1/2 animate-in fade-in-0 zoom-in-95 duration-150"
        style={{ top: "min(12%, calc(100vh - 520px))", width: compact ? "calc(100vw - 1.5rem)" : 520, maxWidth: "calc(100vw - 1rem)" }}
      >
        <div
          className="rounded-xl border border-border bg-popover shadow-2xl overflow-hidden flex flex-col"
          style={{ maxHeight: "min(72vh, calc(100vh - 2rem))" }}
        >
          {/* Header: title + tab bar */}
          <div className="px-5 pt-5 pb-3 border-b border-border shrink-0">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold">Settings</h2>
              <button
                onClick={onClose}
                aria-label="Close"
                className="text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
              >
                <X className="size-4" />
              </button>
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
                updater={updater}
              />
            )}
            {activeTab === "editor" && (
              <EditorTab
                settings={settings}
                onUpdateSettings={onUpdateSettings}
                compact={compact}
              />
            )}
            {activeTab === "account" && account && (
              <AccountTab {...account} />
            )}
            {activeTab === "themes" && (
              <ThemesTab
                settings={settings}
                onUpdateSettings={onUpdateSettings}
                customThemes={customThemes}
                onSaveTheme={onSaveTheme}
                onDeleteTheme={onDeleteTheme}
                compact={compact}
              />
            )}
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
