import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { invoke } from "@tauri-apps/api/core";
import { load, type Store } from "@tauri-apps/plugin-store";
import { readCloudConfig } from "@/cloud/cloud-config";

interface AsyncAuthStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export const MAC_CLOUD_AUTH_REDIRECT_URL =
  "https://ghosteditor.app/auth/native/callback/";

let authStorePromise: Promise<Store> | null = null;

function getAuthStore(): Promise<Store> {
  authStorePromise ??= load("cloud-auth.json", { defaults: {}, autoSave: true });
  return authStorePromise;
}

const appDataStorage: AsyncAuthStorage = {
  async getItem(key) {
    return (await getAuthStore()).get<string>(key).then((value) => value ?? null);
  },
  async setItem(key, value) {
    await (await getAuthStore()).set(key, value);
  },
  async removeItem(key) {
    await (await getAuthStore()).delete(key);
  },
};

let macClient: SupabaseClient | null = null;

/** Mac-only client. Refresh sessions are persisted in dedicated Tauri app data. */
export function getMacCloudClient(): SupabaseClient | null {
  const config = readCloudConfig();
  if (!config) return null;
  if (macClient) return macClient;

  macClient = createClient(config.url, config.publishableKey, {
    auth: {
      storageKey: `ghost-cloud-auth-${config.projectRef}`,
      storage: appDataStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      flowType: "pkce",
    },
  });
  return macClient;
}

export async function openMacCloudOAuthUrl(url: string): Promise<void> {
  await invoke("open_url", { url });
}
