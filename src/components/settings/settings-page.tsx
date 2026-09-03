import { useState } from "react";
import { Settings2, Type, Palette, UserRound } from "lucide-react";
import { FloatingPanel } from "@/components/ui/floating-panel";
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

  return (
    <FloatingPanel
      title="Settings"
      onClose={onClose}
      data-settings-panel
      headerExtra={(
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
      )}
    >
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
    </FloatingPanel>
  );
}
