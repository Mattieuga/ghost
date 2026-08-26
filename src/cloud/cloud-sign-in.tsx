import { useState, type FormEvent } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

export function CloudSignIn({
  client,
  compact = false,
  emailRedirectTo,
}: {
  client: SupabaseClient;
  compact?: boolean;
  emailRedirectTo?: string;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    const credentials = { email: email.trim(), password };
    const result = creating
      ? await client.auth.signUp({
          ...credentials,
          options: emailRedirectTo ? { emailRedirectTo } : undefined,
        })
      : await client.auth.signInWithPassword(credentials);
    setSubmitting(false);
    if (result.error) {
      setMessage(result.error.message);
    } else if (creating && !result.data.session) {
      setMessage(emailRedirectTo
        ? "Check your email to confirm the account. The confirmation link will return you here."
        : "Check your email to confirm the account, then sign in here.");
    }
  };

  return (
    <div className={compact ? "px-3 py-3" : "w-full max-w-md rounded-2xl border border-border bg-card p-7 shadow-2xl shadow-black/20"}>
      <h2 className={compact ? "text-sm font-semibold" : "text-xl font-semibold"}>
        {creating ? "Create a Cloud account" : "Sign in to Ghost Cloud"}
      </h2>
      {!compact ? (
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Local Ghost stays account-free. This account is only for shared Cloud documents.
        </p>
      ) : null}
      <form className="mt-4 space-y-2.5" onSubmit={(event) => void submit(event)}>
        <input
          aria-label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-xs outline-none focus:border-ring"
          placeholder="you@example.com"
        />
        <input
          aria-label="Password"
          type="password"
          autoComplete={creating ? "new-password" : "current-password"}
          minLength={6}
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-xs outline-none focus:border-ring"
          placeholder="Password"
        />
        <button
          type="submit"
          disabled={submitting}
          className="h-9 w-full rounded-md bg-foreground px-3 text-xs font-semibold text-background disabled:opacity-50"
        >
          {submitting ? "Working…" : creating ? "Create account" : "Sign in"}
        </button>
      </form>
      <button
        type="button"
        className="mt-3 text-xs text-muted-foreground hover:text-foreground"
        onClick={() => { setCreating((value) => !value); setMessage(null); }}
      >
        {creating ? "Already have an account? Sign in" : "Need an account? Create one"}
      </button>
      {message ? <p className="mt-3 text-xs leading-5 text-muted-foreground" role="status">{message}</p> : null}
    </div>
  );
}
