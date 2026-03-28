import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export function useFileWatcher(
  paths: string[],
  onFileChange: (changedPath: string) => void
) {
  useEffect(() => {
    if (paths.length === 0) return;

    // Start watching
    invoke("watch_directories", { paths }).catch((err) =>
      console.error("Failed to start file watcher:", err)
    );

    // Listen for changes
    const unlisten = listen<string>("fs-change", (event) => {
      onFileChange(event.payload);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [JSON.stringify(paths), onFileChange]);
}
