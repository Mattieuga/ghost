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
  __ghostSyncToCloud?: () => void;
  __ghostFind?: () => void;
  __ghostFindAndReplace?: () => void;
  __ghostViewerFind?: () => boolean;
  __ghostCopyAs?: (format: string) => Promise<void>;
  __ghostSearch?: GhostSearchCommands;
  __ghostCommandPalette?: () => void;
  __ghostQuickOpen?: () => void;
  __ghostSearchContents?: () => void;
  __ghostFocusTree?: () => void;
  __ghostFocusEditor?: () => void;
  __ghostNavigateBack?: () => void;
  __ghostNavigateForward?: () => void;
  __ghostToggleSidebar?: () => void;
  __ghostSettings?: () => void;
  __ghostToggleStyleBar?: () => void;
  __ghostFlushSave?: () => Promise<void>;
  __ghostFlushEditorSave?: () => Promise<void>;
  __ghostFlushCloudSave?: () => Promise<void>;
  /** Set by the browser client: a relative image path to a URL that serves it. */
  __ghostResolveImage?: (src: string) => Promise<string | null>;
}

declare global {
  interface Window extends GhostWindow {}
}

export {};
