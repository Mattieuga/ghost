/// <reference types="vite/client" />

declare const __GHOST_DEV_BUILD__: boolean;
declare const __GHOST_DEV_LABEL__: string;
declare const __GHOST_DEV_WORKSPACE__: string;

interface ImportMetaEnv {
  /** Where the browser client is hosted; share links point here. */
  readonly VITE_GHOST_WEB_URL?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}
