import { useEffect, useState, type FormEvent } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  beginAppleCloudSignIn,
  loadCloudAuthCapabilities,
  type CloudAuthCapabilities,
} from "@/cloud/cloud-auth";

type EmailStep = "address" | "sent";

export function CloudSignIn({
  client,
  emailRedirectTo,
  oauthRedirectTo = emailRedirectTo,
  openOAuthUrl = (url) => { window.location.assign(url); },
  externalError = null,
  capabilities: capabilitiesOverride,
  onCallbackUrl,
}: {
  client: SupabaseClient;
  emailRedirectTo?: string;
  oauthRedirectTo?: string;
  openOAuthUrl?: (url: string) => void | Promise<void>;
  externalError?: string | null;
  capabilities?: CloudAuthCapabilities;
  /** Finish sign-in from a pasted callback link, for builds the link cannot open. */
  onCallbackUrl?: (url: string) => Promise<string | null>;
}) {
  const [capabilities, setCapabilities] = useState<CloudAuthCapabilities | null>(
    capabilitiesOverride ?? null,
  );
  const [email, setEmail] = useState("");
  const [sentEmail, setSentEmail] = useState("");
  const [step, setStep] = useState<EmailStep>("address");
  const [mode, setMode] = useState<"link" | "password">("link");
  const [password, setPassword] = useState("");
  const [callbackUrl, setCallbackUrl] = useState("");
  const [submitting, setSubmitting] = useState<"apple" | "email" | "password" | "callback" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (capabilitiesOverride) {
      setCapabilities(capabilitiesOverride);
      return;
    }
    let active = true;
    void loadCloudAuthCapabilities().then((next) => {
      if (active) setCapabilities(next);
    }).catch(() => {
      if (active) setCapabilities({ apple: false, email: true });
    });
    return () => { active = false; };
  }, [capabilitiesOverride]);

  const startApple = async () => {
    if (!oauthRedirectTo) {
      setMessage("Apple sign-in needs a configured callback URL.");
      return;
    }
    setSubmitting("apple");
    setMessage(null);
    try {
      await beginAppleCloudSignIn(client, oauthRedirectTo, openOAuthUrl);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSubmitting(null);
    }
  };

  const sendLink = async (event: FormEvent) => {
    event.preventDefault();
    const normalizedEmail = email.trim();
    setSubmitting("email");
    setMessage(null);
    try {
      const { error } = await client.auth.signInWithOtp({
        email: normalizedEmail,
        options: {
          shouldCreateUser: true,
          emailRedirectTo,
        },
      });
      if (error) {
        setMessage(error.message);
        return;
      }
      setSentEmail(normalizedEmail);
      setStep("sent");
      setMessage("Check your email and follow the sign-in link.");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSubmitting(null);
    }
  };

  const changeEmail = () => {
    setStep("address");
    setMessage(null);
  };

  const signInWithPassword = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting("password");
    setMessage(null);
    try {
      const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
      if (error) setMessage(error.message);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSubmitting(null);
    }
  };

  const finishFromCallback = async (event: FormEvent) => {
    event.preventDefault();
    if (!onCallbackUrl) return;
    setSubmitting("callback");
    setMessage(null);
    try {
      const failure = await onCallbackUrl(callbackUrl);
      if (failure) setMessage(failure);
    } finally {
      setSubmitting(null);
    }
  };

  const appleAvailable = capabilities?.apple === true;
  const emailAvailable = capabilities?.email !== false;
  const visibleMessage = message ?? externalError;

  return (
    <div className="w-full max-w-md rounded-2xl border border-border bg-card p-7 shadow-2xl shadow-black/20">
      <h2 className="text-xl font-semibold">
        Ghost Cloud
      </h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        Local Ghost stays account-free. Continue only when you want Cloud or sharing.
      </p>

      <button
        type="button"
        disabled={!appleAvailable || submitting !== null}
        className="mt-4 flex h-9 w-full items-center justify-center rounded-md bg-foreground px-3 text-xs font-semibold text-background disabled:cursor-not-allowed disabled:opacity-45"
        title={capabilities && !capabilities.apple
          ? "Sign in with Apple is not enabled for this Cloud project yet."
          : undefined}
        onClick={() => void startApple()}
      >
        {submitting === "apple" ? "Opening Apple…" : "Continue with Apple"}
      </button>
      {capabilities && !capabilities.apple ? (
        <p className="mt-1.5 text-[10px] leading-4 text-muted-foreground">
          Apple sign-in is not configured yet. Email works now.
        </p>
      ) : null}

      <div className="my-3 flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>

      {step === "address" && mode === "password" ? (
        <form className="space-y-2.5" onSubmit={(event) => void signInWithPassword(event)} data-password-sign-in>
          <input
            aria-label="Email"
            type="email"
            autoComplete="email"
            required
            disabled={submitting !== null}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-xs outline-none focus:border-ring disabled:opacity-50"
            placeholder="you@example.com"
          />
          <input
            aria-label="Password"
            type="password"
            autoComplete="current-password"
            required
            disabled={submitting !== null}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-xs outline-none focus:border-ring disabled:opacity-50"
            placeholder="Password"
          />
          <button
            type="submit"
            disabled={submitting !== null}
            className="h-9 w-full rounded-md border border-border bg-secondary px-3 text-xs font-semibold text-secondary-foreground hover:bg-accent disabled:opacity-50"
          >
            {submitting === "password" ? "Signing in…" : "Sign in"}
          </button>
          <button
            type="button"
            className="w-full text-center text-[11px] text-muted-foreground hover:text-foreground"
            onClick={() => { setMode("link"); setMessage(null); }}
          >
            Use an email link instead
          </button>
        </form>
      ) : step === "address" ? (
        <form className="space-y-2.5" onSubmit={(event) => void sendLink(event)}>
          <input
            aria-label="Email"
            type="email"
            autoComplete="email"
            required
            disabled={!emailAvailable || submitting !== null}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-xs outline-none focus:border-ring disabled:opacity-50"
            placeholder="you@example.com"
          />
          <button
            type="submit"
            disabled={!emailAvailable || submitting !== null}
            className="h-9 w-full rounded-md border border-border bg-secondary px-3 text-xs font-semibold text-secondary-foreground hover:bg-accent disabled:opacity-50"
          >
            {submitting === "email" ? "Sending…" : "Continue with email"}
          </button>
          <button
            type="button"
            className="w-full text-center text-[11px] text-muted-foreground hover:text-foreground"
            onClick={() => { setMode("password"); setMessage(null); }}
          >
            Use a password instead
          </button>
        </form>
      ) : (
        <div className="space-y-2.5">
          <p className="text-xs leading-5 text-muted-foreground">
            We sent a sign-in link to <span className="text-foreground">{sentEmail}</span>.
          </p>
          <button
            type="button"
            className="w-full text-center text-[11px] text-muted-foreground hover:text-foreground"
            onClick={changeEmail}
          >
            Use a different email
          </button>
          {onCallbackUrl ? (
            <form className="space-y-1.5 border-t border-border pt-2.5" onSubmit={(event) => void finishFromCallback(event)} data-callback-fallback>
              <p className="text-[11px] leading-4 text-muted-foreground">
                If the link opens in your browser instead of Ghost, copy the address the browser lands on and paste it here.
              </p>
              <input
                aria-label="Sign-in link"
                type="url"
                required
                disabled={submitting !== null}
                value={callbackUrl}
                onChange={(event) => setCallbackUrl(event.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-xs outline-none focus:border-ring disabled:opacity-50"
                placeholder="https://ghosteditor.app/auth/native/callback/?code=…"
              />
              <button
                type="submit"
                disabled={submitting !== null}
                className="h-8 w-full rounded-md border border-border px-3 text-xs text-secondary-foreground hover:bg-accent disabled:opacity-50"
              >
                {submitting === "callback" ? "Finishing…" : "Finish sign-in"}
              </button>
            </form>
          ) : null}
        </div>
      )}

      {visibleMessage ? (
        <p className="mt-3 text-xs leading-5 text-muted-foreground" role="status">
          {visibleMessage}
        </p>
      ) : null}
    </div>
  );
}
