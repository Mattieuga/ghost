import { useEffect, useState, type FormEvent } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  beginAppleCloudSignIn,
  loadCloudAuthCapabilities,
  type CloudAuthCapabilities,
} from "@/cloud/cloud-auth";

type EmailStep = "address" | "code";

export function CloudSignIn({
  client,
  compact = false,
  emailRedirectTo,
  oauthRedirectTo = emailRedirectTo,
  openOAuthUrl = (url) => { window.location.assign(url); },
  externalError = null,
  capabilities: capabilitiesOverride,
}: {
  client: SupabaseClient;
  compact?: boolean;
  emailRedirectTo?: string;
  oauthRedirectTo?: string;
  openOAuthUrl?: (url: string) => void | Promise<void>;
  externalError?: string | null;
  capabilities?: CloudAuthCapabilities;
}) {
  const [capabilities, setCapabilities] = useState<CloudAuthCapabilities | null>(
    capabilitiesOverride ?? null,
  );
  const [email, setEmail] = useState("");
  const [sentEmail, setSentEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<EmailStep>("address");
  const [submitting, setSubmitting] = useState<"apple" | "email" | "code" | null>(null);
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

  const sendCode = async (event: FormEvent) => {
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
      setStep("code");
      setMessage("Check your email for a six-digit code or sign-in link.");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSubmitting(null);
    }
  };

  const verifyCode = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting("code");
    setMessage(null);
    try {
      const { error } = await client.auth.verifyOtp({
        email: sentEmail,
        token: code.trim(),
        type: "email",
      });
      if (error) setMessage(error.message);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSubmitting(null);
    }
  };

  const changeEmail = () => {
    setStep("address");
    setCode("");
    setMessage(null);
  };

  const appleAvailable = capabilities?.apple === true;
  const emailAvailable = capabilities?.email !== false;
  const visibleMessage = message ?? externalError;

  return (
    <div className={compact ? "px-3 py-3" : "w-full max-w-md rounded-2xl border border-border bg-card p-7 shadow-2xl shadow-black/20"}>
      <h2 className={compact ? "text-sm font-semibold" : "text-xl font-semibold"}>
        Ghost Cloud
      </h2>
      {!compact ? (
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Local Ghost stays account-free. Continue only when you want Cloud or sharing.
        </p>
      ) : null}

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

      {step === "address" ? (
        <form className="space-y-2.5" onSubmit={(event) => void sendCode(event)}>
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
        </form>
      ) : (
        <form className="space-y-2.5" onSubmit={(event) => void verifyCode(event)}>
          <p className="text-xs leading-5 text-muted-foreground">
            Enter the code sent to <span className="text-foreground">{sentEmail}</span>.
          </p>
          <input
            aria-label="Six-digit code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            minLength={6}
            maxLength={6}
            required
            autoFocus
            disabled={submitting !== null}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-center font-mono text-base tracking-[0.35em] outline-none focus:border-ring disabled:opacity-50"
            placeholder="000000"
          />
          <button
            type="submit"
            disabled={submitting !== null || code.length !== 6}
            className="h-9 w-full rounded-md border border-border bg-secondary px-3 text-xs font-semibold text-secondary-foreground hover:bg-accent disabled:opacity-50"
          >
            {submitting === "code" ? "Checking…" : "Continue"}
          </button>
          <button
            type="button"
            className="w-full text-center text-[11px] text-muted-foreground hover:text-foreground"
            onClick={changeEmail}
          >
            Use a different email
          </button>
        </form>
      )}

      {visibleMessage ? (
        <p className="mt-3 text-xs leading-5 text-muted-foreground" role="status">
          {visibleMessage}
        </p>
      ) : null}
    </div>
  );
}
