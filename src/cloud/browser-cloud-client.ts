import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readCloudConfig } from "@/cloud/cloud-config";

let browserClient: SupabaseClient | null = null;

/** Browser-only account client. The Mac shell will use Keychain-backed auth. */
export function getBrowserCloudClient(): SupabaseClient | null {
  const config = readCloudConfig();
  if (!config) return null;
  if (browserClient) return browserClient;

  browserClient = createClient(config.url, config.publishableKey, {
    auth: {
      storageKey: `ghost-cloud-auth-${config.projectRef}`,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: "pkce",
    },
  });
  return browserClient;
}
