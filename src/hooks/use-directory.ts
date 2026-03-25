import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { FileEntry } from "@/types";

export function useDirectory(
  path: string,
  extensions: string[],
  refreshTrigger?: number
) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const fetchEntries = useCallback(() => {
    if (!path) return;
    invoke<FileEntry[]>("read_directory", { path, extensions })
      .then((result) => {
        setEntries(result);
        setError(null);
      })
      .catch((err) => {
        setError(String(err));
        setEntries([]);
      });
  }, [path, extensions.join(",")]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries, refreshTrigger]);

  return { entries, error, refresh: fetchEntries };
}
