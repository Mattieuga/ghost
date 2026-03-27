import { useState, useEffect, useCallback } from "react";
import { load } from "@tauri-apps/plugin-store";

export interface Settings {
  showAllFiles: boolean;
  theme: "system" | "dark" | "light";
}

const DEFAULTS: Settings = {
  showAllFiles: false,
  theme: "system",
};

const STORE_KEY = "settings";

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);

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

  const updateSettings = useCallback(async (updates: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...updates };
      load("settings.json", { defaults: {}, autoSave: true }).then(
        async (store) => {
          await store.set(STORE_KEY, next);
        }
      );
      return next;
    });
  }, []);

  return { settings, updateSettings };
}
