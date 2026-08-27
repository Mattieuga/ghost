import type { SupabaseClient } from "@supabase/supabase-js";
import { readCloudConfig } from "@/cloud/cloud-config";

export interface CloudAuthCapabilities {
  apple: boolean;
  email: boolean;
}

interface SupabaseAuthSettings {
  external?: Record<string, boolean | undefined>;
}

export async function loadCloudAuthCapabilities(): Promise<CloudAuthCapabilities> {
  const config = readCloudConfig();
  if (!config) return { apple: false, email: false };

  const response = await fetch(`${config.url}/auth/v1/settings`, {
    headers: { apikey: config.publishableKey },
  });
  if (!response.ok) throw new Error("Could not check available Cloud sign-in methods.");
  const settings = await response.json() as SupabaseAuthSettings;
  return {
    apple: settings.external?.apple === true,
    email: settings.external?.email === true,
  };
}

export async function beginAppleCloudSignIn(
  client: SupabaseClient,
  redirectTo: string,
  openOAuthUrl: (url: string) => void | Promise<void>,
): Promise<void> {
  const { data, error } = await client.auth.signInWithOAuth({
    provider: "apple",
    options: {
      redirectTo,
      skipBrowserRedirect: true,
    },
  });
  if (error) throw error;
  if (!data.url) throw new Error("Apple sign-in did not return an authorization URL.");
  await openOAuthUrl(data.url);
}
