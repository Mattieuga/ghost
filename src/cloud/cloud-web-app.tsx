import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { User } from "@supabase/supabase-js";
import { getBrowserCloudClient } from "@/cloud/browser-cloud-client";

type AccountState =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "signed-in"; user: User }
  | { kind: "error"; message: string };

export function CloudWebApp() {
  const client = useMemo(() => getBrowserCloudClient(), []);
  const [account, setAccount] = useState<AccountState>(
    client ? { kind: "loading" } : { kind: "error", message: "Ghost Cloud is not configured." },
  );

  useEffect(() => {
    if (!client) return;
    let active = true;

    void client.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) {
        setAccount({ kind: "error", message: error.message });
      } else if (data.session?.user) {
        setAccount({ kind: "signed-in", user: data.session.user });
      } else {
        setAccount({ kind: "signed-out" });
      }
    });

    const { data: authListener } = client.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setAccount(session?.user
        ? { kind: "signed-in", user: session.user }
        : { kind: "signed-out" });
    });

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, [client]);

  return (
    <main className="min-h-svh overflow-auto bg-background px-6 py-8 text-foreground sm:px-10">
      <div className="mx-auto flex min-h-[calc(100svh-4rem)] max-w-5xl flex-col">
        <header className="flex items-center justify-between border-b border-border pb-5">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ghost-amber">
              Ghost Cloud
            </div>
            <h1 className="mt-1 font-serif text-2xl">Markdown, together.</h1>
          </div>
          {account.kind === "signed-in" && client ? (
            <button
              type="button"
              className="rounded-full border border-border px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => void client.auth.signOut()}
            >
              Sign out
            </button>
          ) : null}
        </header>

        <section className="flex flex-1 items-center justify-center py-16">
          {account.kind === "loading" ? <CloudNotice>Loading your account…</CloudNotice> : null}
          {account.kind === "error" ? (
            <CloudNotice title="Cloud unavailable">{account.message}</CloudNotice>
          ) : null}
          {account.kind === "signed-out" && client ? <EmailSignIn client={client} /> : null}
          {account.kind === "signed-in" ? <SignedInHome user={account.user} /> : null}
        </section>
      </div>
    </main>
  );
}

function EmailSignIn({ client }: { client: NonNullable<ReturnType<typeof getBrowserCloudClient>> }) {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    const redirectTo = new URL("web.html", document.baseURI).href;
    const { error } = await client.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirectTo },
    });
    setSubmitting(false);
    setMessage(error ? error.message : "Check your email for a sign-in link.");
  };

  return (
    <div className="w-full max-w-md rounded-2xl border border-border bg-card p-7 shadow-2xl shadow-black/20">
      <h2 className="text-xl font-semibold">Sign in to your Cloud workspace</h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        Local Ghost stays account-free. Sign in only for shared Cloud documents.
      </p>
      <form className="mt-6 space-y-3" onSubmit={(event) => void submit(event)}>
        <label className="block text-xs font-medium uppercase tracking-wider text-muted-foreground" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-ring"
          placeholder="you@example.com"
        />
        <button
          type="submit"
          disabled={submitting}
          className="h-11 w-full rounded-lg bg-foreground px-4 text-sm font-semibold text-background transition-opacity disabled:opacity-50"
        >
          {submitting ? "Sending…" : "Email me a sign-in link"}
        </button>
      </form>
      {message ? <p className="mt-4 text-sm text-muted-foreground" role="status">{message}</p> : null}
    </div>
  );
}

function SignedInHome({ user }: { user: User }) {
  return (
    <div className="w-full">
      <div className="mb-8 flex items-end justify-between gap-6">
        <div>
          <p className="text-sm text-muted-foreground">Signed in as {user.email ?? "Ghost user"}</p>
          <h2 className="mt-2 text-3xl font-semibold">Your Cloud</h2>
        </div>
      </div>
      <div className="rounded-2xl border border-dashed border-border px-8 py-20 text-center">
        <p className="text-base font-medium">No Cloud documents yet</p>
        <p className="mt-2 text-sm text-muted-foreground">
          The private folder and document tree is the next production slice.
        </p>
      </div>
    </div>
  );
}

function CloudNotice({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="max-w-lg rounded-xl border border-border bg-card px-6 py-5 text-center">
      {title ? <h2 className="mb-2 text-lg font-semibold">{title}</h2> : null}
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
