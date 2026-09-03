import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { invoke } from "@tauri-apps/api/core";
import { CloudSignIn } from "@/cloud/cloud-sign-in";
import type { CloudAccountState } from "@/cloud/use-cloud-account";
import { Button } from "@/components/ui/button";
import type { SignInSurfaceProps } from "@/mirror/share-sheet";

export interface AccountTabProps {
  client: SupabaseClient | null;
  account: CloudAccountState;
  signIn: SignInSurfaceProps;
  onSignOut: () => Promise<void>;
  /** `~/Ghost`, where Notes and Shared live. */
  ghostFolderPath: string | null;
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {description ? <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</p> : null}
      </div>
      {children ? <div className="shrink-0">{children}</div> : null}
    </div>
  );
}

/** A password is optional. It exists for builds the email link cannot reach. */
function SetPasswordCard({ client }: { client: SupabaseClient }) {
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setNote(null);
    try {
      const { error } = await client.auth.updateUser({ password });
      setNote(error ? error.message : "Password set. You can sign in with it next time.");
      if (!error) setPassword("");
    } catch (reason) {
      setNote(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border bg-card p-6 space-y-4" data-set-password>
      <SettingRow
        label="Password"
        description="Optional. Lets you sign in without the email link, for example on a build the link cannot open."
      />
      <form className="flex items-center gap-2" onSubmit={(event) => void save(event)}>
        <input
          aria-label="New password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          disabled={saving}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="h-9 flex-1 rounded-md border border-input bg-background px-2.5 text-xs outline-none focus:border-ring disabled:opacity-50"
          placeholder="At least 8 characters"
        />
        <Button size="sm" variant="outline" type="submit" disabled={saving}>
          {saving ? "Saving…" : "Set password"}
        </Button>
      </form>
      {note ? <p className="text-xs leading-5 text-muted-foreground" role="status">{note}</p> : null}
    </div>
  );
}

/**
 * Settings → Account. The third and last place sign-in lives, and the only
 * place sign-out lives. Signing out never touches files; sync pauses.
 */
export function AccountTab({ client, account, signIn, onSignOut, ghostFolderPath }: AccountTabProps) {
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signOut = async () => {
    setSigningOut(true);
    setError(null);
    try {
      await onSignOut();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div className="space-y-6" data-account-tab>
      <div className="rounded-xl border bg-card p-6 space-y-4">
        {!client ? (
          <SettingRow
            label="Cloud"
            description="This build of Ghost has no Cloud configured. Notes stay on this Mac."
          />
        ) : account.kind === "signed-in" ? (
          <>
            <SettingRow
              label="Signed in"
              description={account.user.email ?? account.user.id}
            >
              <Button size="sm" variant="outline" disabled={signingOut} onClick={() => void signOut()}>
                {signingOut ? "Signing out…" : "Sign out"}
              </Button>
            </SettingRow>
            <p className="text-xs leading-5 text-muted-foreground">
              Signing out pauses sync. Nothing on this Mac is deleted, and your notes stay where they are.
            </p>
            {error ? <p className="text-xs text-destructive" role="alert">{error}</p> : null}
          </>
        ) : (
          <>
            <SettingRow
              label="Not signed in"
              description="Local Ghost stays account-free. Sign in when you want your notes on your phone or shared with someone."
            />
            <div className="[&>div]:max-w-none [&>div]:border-0 [&>div]:bg-transparent [&>div]:p-0 [&>div]:shadow-none">
              <CloudSignIn
                client={client}
                emailRedirectTo={signIn.emailRedirectTo}
                oauthRedirectTo={signIn.oauthRedirectTo}
                openOAuthUrl={signIn.openOAuthUrl}
                externalError={account.kind === "error" ? account.message : signIn.externalError}
                onCallbackUrl={signIn.completeCallback}
              />
            </div>
          </>
        )}
      </div>

      {client && account.kind === "signed-in" ? (
        <SetPasswordCard client={client} />
      ) : null}

      <div className="rounded-xl border bg-card p-6 space-y-4">
        <SettingRow
          label="Ghost folder"
          description={ghostFolderPath
            ? `${ghostFolderPath}. Notes and folders shared with you live here as plain Markdown.`
            : "Notes and folders shared with you live in ~/Ghost as plain Markdown."}
        >
          {ghostFolderPath ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => { void invoke("reveal_in_finder", { path: ghostFolderPath }).catch(() => undefined); }}
            >
              Reveal in Finder
            </Button>
          ) : null}
        </SettingRow>
      </div>
    </div>
  );
}
