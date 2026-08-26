import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { invoke } from "@tauri-apps/api/core";
import { readCloudConfig } from "@/cloud/cloud-config";

interface AsyncAuthStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const keychainStorage: AsyncAuthStorage = {
  getItem: (key) => invoke<string | null>("cloud_auth_storage_get", { key }),
  setItem: (key, value) => invoke("cloud_auth_storage_set", { key, value }),
  removeItem: (key) => invoke("cloud_auth_storage_remove", { key }),
};

let macClient: SupabaseClient | null = null;

/** Mac-only client. Refresh sessions are persisted in the login Keychain. */
export function getMacCloudClient(): SupabaseClient | null {
  const config = readCloudConfig();
  if (!config) return null;
  if (macClient) return macClient;

  macClient = createClient(config.url, config.publishableKey, {
    auth: {
      storageKey: `ghost-cloud-auth-${config.projectRef}`,
      storage: keychainStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  return macClient;
}
