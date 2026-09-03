import { invoke } from "@tauri-apps/api/core";

/** Result of `ensure_notes_folder`, mirrored from the Rust command. */
export interface NotesFolder {
  path: string;
  created: boolean;
  welcome_path: string | null;
}

/** Absolute path of `~/Ghost`, the default home for Ghost-created folders. */
export function ghostFolder(): Promise<string> {
  return invoke<string>("ghost_folder");
}

/**
 * Create `~/Ghost/Notes` when it is missing. A brand-new Notes folder gets the
 * welcome note; an existing one is left alone.
 */
export function ensureNotesFolder(): Promise<NotesFolder> {
  return invoke<NotesFolder>("ensure_notes_folder");
}
