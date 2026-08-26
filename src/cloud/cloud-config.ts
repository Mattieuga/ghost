export interface CloudEnvironment {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

export interface CloudConfig {
  url: string;
  publishableKey: string;
  projectRef: string;
}

export function resolveCloudConfig(environment: CloudEnvironment): CloudConfig | null {
  const url = environment.VITE_SUPABASE_URL?.trim();
  const publishableKey = environment.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !publishableKey) return null;

  let projectRef: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
      throw new Error("Cloud endpoints must use HTTPS");
    }
    projectRef = parsed.hostname.split(".")[0] || "local";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`VITE_SUPABASE_URL is invalid: ${message}`);
  }

  return { url, publishableKey, projectRef };
}

export function readCloudConfig(): CloudConfig | null {
  return resolveCloudConfig(import.meta.env);
}
