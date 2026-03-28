export interface FileEntry {
  name: string;
  path: string;
  is_directory: boolean;
  children: FileEntry[] | null;
}

export interface FlatFileEntry {
  name: string;
  path: string;
  folderDisplay: string; // relative path from tracked folder root
}
