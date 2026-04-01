interface GhostSearchCommands {
  next: () => void;
  previous: () => void;
  replace: () => void;
  replaceAll: () => void;
}

interface GhostWindow {
  __ghostActiveFile?: string;
  __ghostAddFolder?: () => void;
  __ghostNewFile?: () => void;
  __ghostFind?: () => void;
  __ghostFindAndReplace?: () => void;
  __ghostCopyAs?: (format: string) => Promise<void>;
  __ghostSearch?: GhostSearchCommands;
  __ghostCommandPalette?: () => void;
}

declare global {
  interface Window extends GhostWindow {}
}

export {};
