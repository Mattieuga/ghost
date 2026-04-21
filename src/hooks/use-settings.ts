import { useState, useEffect, useCallback, useRef } from "react";
import { load } from "@tauri-apps/plugin-store";
import { emit, listen } from "@tauri-apps/api/event";
import type { ThemeColors, ThemePreset } from "@/lib/theme-engine";
import { DEFAULT_THEME } from "@/lib/theme-engine";

export interface Settings {
  showAllFiles: boolean;
  showStyleBar: boolean;
  theme: string;
  themeColors: ThemeColors;
  syntaxPalette?: string;
  customThemes: ThemePreset[];
  textFont: string;
  headingFont: string;
  codeFont: string;
  fontSize: number;
  lineHeight: number;
  editorWidth: number;
  paragraphSpacing: number;
  headingSpacing: number;
  countMode: "words" | "chars" | "lines" | "tokens";
}

const DEFAULTS: Settings = {
  showAllFiles: true,
  showStyleBar: true,
  theme: "factory",
  themeColors: {
    editorBg: DEFAULT_THEME.editorBg,
    sidebarBg: DEFAULT_THEME.sidebarBg,
    text: DEFAULT_THEME.text,
    accent: DEFAULT_THEME.accent,
    heading: DEFAULT_THEME.heading,
  },
  customThemes: [],
  textFont: "Inter",
  headingFont: "Inter",
  codeFont: "JetBrains Mono",
  fontSize: 16,
  lineHeight: 1.60,
  editorWidth: 730,
  paragraphSpacing: 0.50,
  headingSpacing: 0.80,
  countMode: "words",
};

const STORE_KEY = "settings";

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const storeRef = useRef<Awaited<ReturnType<typeof load>> | null>(null);

  useEffect(() => {
    load("settings.json", { defaults: {}, autoSave: true }).then(
      async (store) => {
        storeRef.current = store;
        const saved = await store.get<Settings>(STORE_KEY);
        if (saved) {
          setSettings({ ...DEFAULTS, ...saved });
        }
      }
    ).catch((err) => console.error("Failed to load settings:", err));
  }, []);

  // Listen for settings changes from other windows
  useEffect(() => {
    const unlisten = listen<Settings>("settings-changed", (event) => {
      setSettings({ ...DEFAULTS, ...event.payload });
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  const persist = useCallback((next: Settings) => {
    const store = storeRef.current;
    if (store) {
      store.set(STORE_KEY, next).catch((err) =>
        console.error("Failed to persist settings:", err)
      );
    }
    // Notify other windows
    emit("settings-changed", next).catch(() => {});
  }, []);

  const updateSettings = useCallback((updates: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...updates };
      persist(next);
      return next;
    });
  }, [persist]);

  const saveTheme = useCallback((preset: ThemePreset) => {
    setSettings((prev) => {
      const customThemes = [preset, ...prev.customThemes.filter((t) => t.id !== preset.id)];
      const next = { ...prev, customThemes, theme: preset.id };
      persist(next);
      return next;
    });
  }, [persist]);

  const deleteTheme = useCallback((id: string) => {
    setSettings((prev) => {
      const customThemes = prev.customThemes.filter((t) => t.id !== id);
      // Fall back to default theme if the active theme was deleted
      const isActive = prev.theme === id;
      const next = {
        ...prev,
        customThemes,
        ...(isActive ? { theme: DEFAULT_THEME.id, themeColors: DEFAULT_THEME } : {}),
      };
      persist(next);
      return next;
    });
  }, [persist]);

  return { settings, updateSettings, saveTheme, deleteTheme };
}
