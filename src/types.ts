export interface FileEntry {
  name: string;
  path: string;
  is_directory: boolean;
  children: FileEntry[] | null;
}
