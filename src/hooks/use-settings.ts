import { useState, useEffect, useCallback, useRef } from "react";
import { load } from "@tauri-apps/plugin-store";

export interface Settings {
  showAllFiles: boolean;
  theme: "system" | "dark" | "light";
  fontSize: number;
  lineHeight: number;
  editorWidth: number;
}

const DEFAULTS: Settings = {
  showAllFiles: false,
  theme: "system",
  fontSize: 16,
  lineHeight: 1.75,
  editorWidth: 730,
};

const STORE_KEY = "settings";

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    load("settings.json", { defaults: {}, autoSave: true }).then(
      async (store) => {
        const saved = await store.get<Settings>(STORE_KEY);
        if (saved) {
          setSettings({ ...DEFAULTS, ...saved });
        }
      }
    );
  }, []);

  const updateSettings = useCallback((updates: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...updates };
      // Debounce persistence — UI updates immediately, store writes once after 300ms
      if (persistTimer.current) clearTimeout(persistTimer.current);
      persistTimer.current = setTimeout(() => {
        load("settings.json", { defaults: {}, autoSave: true }).then(
          (store) => store.set(STORE_KEY, next)
        );
      }, 300);
      return next;
    });
  }, []);

  return { settings, updateSettings };
}
