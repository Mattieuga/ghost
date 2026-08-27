// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudSignIn } from "../src/cloud/cloud-sign-in";
import { parseMacCloudAuthCallback } from "../src/cloud/use-mac-cloud-auth-callback";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ root: ReturnType<typeof createRoot>; host: HTMLDivElement }> = [];

afterEach(() => {
  while (mounted.length) {
    const item = mounted.pop();
    act(() => item?.root.unmount());
    item?.host.remove();
  }
});

function buttonWithText(host: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(host.querySelectorAll("button"))
    .find((candidate) => candidate.textContent?.trim() === text);
  if (!button) throw new Error(`Could not find button: ${text}`);
  return button;
}

async function inputText(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setValue?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function createAuthClient() {
  const signInWithOtp = vi.fn(async () => ({ data: {}, error: null }));
  const verifyOtp = vi.fn(async () => ({ data: {}, error: null }));
  const signInWithOAuth = vi.fn(async () => ({
    data: { provider: "apple", url: "https://project.supabase.co/auth/v1/authorize" },
    error: null,
  }));
  const client = {
    auth: { signInWithOtp, verifyOtp, signInWithOAuth },
  } as unknown as SupabaseClient;
  return { client, signInWithOtp, verifyOtp, signInWithOAuth };
}

async function renderSignIn(client: SupabaseClient, openOAuthUrl = vi.fn()) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  await act(async () => {
    root.render(
      <CloudSignIn
        client={client}
        capabilities={{ apple: true, email: true }}
        emailRedirectTo="ghost-md://auth/callback"
        oauthRedirectTo="ghost-md://auth/callback"
        openOAuthUrl={openOAuthUrl}
      />,
    );
  });
  return { host, openOAuthUrl };
}

describe("Cloud passwordless sign in", () => {
  it("sends and verifies an email code without asking for a password", async () => {
    const auth = createAuthClient();
    const { host } = await renderSignIn(auth.client);
    expect(host.querySelector('input[type="password"]')).toBeNull();

    const email = host.querySelector<HTMLInputElement>('input[aria-label="Email"]');
    if (!email) throw new Error("Email input did not render");
    await inputText(email, " person@example.com ");
    await act(async () => buttonWithText(host, "Continue with email").click());

    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: "person@example.com",
      options: {
        shouldCreateUser: true,
        emailRedirectTo: "ghost-md://auth/callback",
      },
    });

    const code = host.querySelector<HTMLInputElement>('input[aria-label="Six-digit code"]');
    if (!code) throw new Error("Code input did not render");
    await inputText(code, "123456");
    await act(async () => {
      code.form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(auth.verifyOtp).toHaveBeenCalledWith({
      email: "person@example.com",
      token: "123456",
      type: "email",
    });
  });

  it("opens Apple OAuth externally with the Mac callback", async () => {
    const auth = createAuthClient();
    const openOAuthUrl = vi.fn(async () => undefined);
    const { host } = await renderSignIn(auth.client, openOAuthUrl);

    await act(async () => buttonWithText(host, "Continue with Apple").click());
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "apple",
      options: {
        redirectTo: "ghost-md://auth/callback",
        skipBrowserRedirect: true,
      },
    });
    expect(openOAuthUrl).toHaveBeenCalledWith(
      "https://project.supabase.co/auth/v1/authorize",
    );
  });
});

describe("Mac Cloud auth callback", () => {
  it("accepts only the registered callback shape", () => {
    expect(parseMacCloudAuthCallback("ghost-md://auth/callback?code=secret-code"))
      .toEqual({ kind: "code", code: "secret-code" });
    expect(parseMacCloudAuthCallback("ghost-md://auth/callback?error_description=Denied"))
      .toEqual({ kind: "error", message: "Denied" });
    expect(parseMacCloudAuthCallback("https://example.com/callback?code=secret-code"))
      .toBeNull();
    expect(parseMacCloudAuthCallback("ghost-md://different/callback?code=secret-code"))
      .toBeNull();
  });
});
