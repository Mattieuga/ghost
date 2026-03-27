interface GhostSearchCommands {
  next: () => void;
  previous: () => void;
  replace: () => void;
  replaceAll: () => void;
}

interface GhostWindow {
  __ghostAddFolder?: () => void;
  __ghostNewFile?: () => void;
  __ghostFind?: () => void;
  __ghostFindAndReplace?: () => void;
  __ghostCopyAs?: (format: string) => Promise<void>;
  __ghostSearch?: GhostSearchCommands;
}

declare global {
  interface Window extends GhostWindow {}
}

export {};
