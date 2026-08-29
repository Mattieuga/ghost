import { useEffect, useState } from "react";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import type { SupabaseClient } from "@supabase/supabase-js";

export type MacCloudAuthCallback =
  | { kind: "code"; code: string }
  | { kind: "error"; message: string };

const callbackExchanges = new Map<string, Promise<string | null>>();

export function parseMacCloudAuthCallback(rawUrl: string): MacCloudAuthCallback | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  const customScheme = url.protocol === "ghost-md:" &&
    url.hostname === "auth" &&
    url.pathname === "/callback";
  const universalLink = url.protocol === "https:" &&
    url.hostname === "ghosteditor.app" &&
    (url.pathname === "/auth/native/callback" || url.pathname === "/auth/native/callback/");
  if (!customScheme && !universalLink) {
    return null;
  }

  const fragment = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  const error = url.searchParams.get("error_description")
    ?? fragment.get("error_description")
    ?? url.searchParams.get("error")
    ?? fragment.get("error");
  if (error) return { kind: "error", message: error };

  const code = url.searchParams.get("code") ?? fragment.get("code");
  return code ? { kind: "code", code } : {
    kind: "error",
    message: "Ghost received an incomplete Cloud sign-in callback.",
  };
}

export function useMacCloudAuthCallback(client: SupabaseClient | null): string | null {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client) return;
    let active = true;
    let unlisten: (() => void) | null = null;

    const processUrls = async (urls: string[] | null) => {
      for (const rawUrl of urls ?? []) {
        const callback = parseMacCloudAuthCallback(rawUrl);
        if (!callback) continue;
        if (callback.kind === "error") {
          if (active) setError(callback.message);
          continue;
        }
        let exchange = callbackExchanges.get(rawUrl);
        if (!exchange) {
          exchange = client.auth.exchangeCodeForSession(callback.code)
            .then(({ error: exchangeError }) => exchangeError?.message ?? null)
            .catch((reason: unknown) => reason instanceof Error ? reason.message : String(reason));
          callbackExchanges.set(rawUrl, exchange);
        }
        const exchangeError = await exchange;
        if (exchangeError) callbackExchanges.delete(rawUrl);
        if (active) setError(exchangeError);
      }
    };

    void (async () => {
      unlisten = await onOpenUrl((urls) => { void processUrls(urls); });
      await processUrls(await getCurrent());
    })().catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason));
    });

    return () => {
      active = false;
      unlisten?.();
    };
  }, [client]);

  return error;
}
