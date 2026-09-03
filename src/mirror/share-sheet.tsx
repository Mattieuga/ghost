import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CloudAccountState } from "@/cloud/use-cloud-account";
import { CloudSignIn } from "@/cloud/cloud-sign-in";
import {
  createCloudShareLink,
  getCloudItemSharing,
  isMissingSharingFunction,
  revokeCloudAccess,
  revokeCloudShareLink,
  shareCloudItem,
  shareLinkUrl,
  type CloudItemSharing,
  type CloudShareRole,
} from "@/cloud/cloud-sharing";
import type { TrackedRoot } from "@/hooks/use-tracked-folders";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export interface SignInSurfaceProps {
  emailRedirectTo: string;
  oauthRedirectTo: string;
  openOAuthUrl: (url: string) => void | Promise<void>;
  externalError: string | null;
  /** Finish sign-in from a pasted callback link when the universal link cannot reach this build. */
  completeCallback?: (url: string) => Promise<string | null>;
}

/** Where the browser client is hosted; share links point here. */
export const GHOST_WEB_URL: string = (import.meta.env.VITE_GHOST_WEB_URL as string | undefined)?.trim()
  || "https://ghosteditor.app/app";

function nameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1) || path;
}

function messageOf(reason: unknown): string {
  if (isMissingSharingFunction(reason)) return "Cloud needs a server update before sharing works.";
  return reason instanceof Error ? reason.message : String(reason);
}

async function copyText(text: string): Promise<void> {
  try {
    const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
    await writeText(text);
  } catch {
    await navigator.clipboard.writeText(text);
  }
}

function roleLabel(role: CloudShareRole): string {
  return role === "editor" ? "can edit" : "can view";
}

/**
 * Sharing for one note that is in Cloud: links anyone can open, and people
 * invited by email. Every change reloads the summary from the server so the
 * sheet never shows access that was not granted.
 */
export function SharePanel({
  client,
  itemId,
  webAppUrl,
  copy = copyText,
}: {
  client: SupabaseClient;
  itemId: string;
  webAppUrl: string;
  copy?: (text: string) => Promise<void>;
}) {
  const [sharing, setSharing] = useState<CloudItemSharing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<CloudShareRole>("editor");

  const reload = useCallback(async () => {
    try {
      setSharing(await getCloudItemSharing(client, itemId));
      setError(null);
    } catch (reason) {
      setError(messageOf(reason));
    }
  }, [client, itemId]);

  useEffect(() => { void reload(); }, [reload]);

  const run = async (work: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    try {
      const message = await work();
      if (message) setNotice(message);
      await reload();
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setBusy(false);
    }
  };

  const copyLink = (role: CloudShareRole) => run(async () => {
    const link = await createCloudShareLink(client, itemId, role);
    await copy(shareLinkUrl(link.token, webAppUrl));
    return role === "editor" ? "Edit link copied." : "View link copied.";
  });

  const invite = (event: React.FormEvent) => {
    event.preventDefault();
    const email = inviteEmail.trim();
    if (!email) return;
    void run(async () => {
      const outcome = await shareCloudItem(client, itemId, email, inviteRole);
      setInviteEmail("");
      return outcome.kind === "member"
        ? `${outcome.email} ${roleLabel(outcome.role)} now.`
        : `${outcome.email} gets access when they sign in.`;
    });
  };

  return (
    <div className="mt-3 space-y-5 text-sm" data-share-panel>
      <section className="space-y-2" data-share-links>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Anyone with the link</h3>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void copyLink("viewer")}>
            Copy view link
          </Button>
          <Button size="sm" disabled={busy} onClick={() => void copyLink("editor")}>
            Copy edit link
          </Button>
        </div>
        {sharing?.links.length ? (
          <ul className="space-y-1">
            {sharing.links.map((link) => (
              <li key={link.id} className="flex items-center justify-between gap-3 text-muted-foreground">
                <span>
                  {link.role === "editor" ? "Edit" : "View"} link
                  {link.expires_at ? ` · expires ${new Date(link.expires_at).toLocaleDateString()}` : ""}
                </span>
                <button
                  type="button"
                  className="cursor-pointer text-xs hover:text-foreground"
                  disabled={busy}
                  onClick={() => void run(async () => { await revokeCloudShareLink(client, link.id); return "Link revoked."; })}
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="space-y-2" data-share-people>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">People</h3>
        <form className="flex gap-2" onSubmit={invite}>
          <Input
            type="email"
            placeholder="name@example.com"
            aria-label="Email address"
            value={inviteEmail}
            onChange={(event) => setInviteEmail(event.target.value)}
            className="h-8 flex-1"
          />
          <select
            aria-label="Access"
            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
            value={inviteRole}
            onChange={(event) => setInviteRole(event.target.value as CloudShareRole)}
          >
            <option value="editor">Can edit</option>
            <option value="viewer">Can view</option>
          </select>
          <Button size="sm" type="submit" disabled={busy || !inviteEmail.trim()}>Invite</Button>
        </form>
        {sharing && (sharing.members.length > 0 || sharing.invitations.length > 0) ? (
          <ul className="space-y-1">
            {sharing.members.map((member) => (
              <li key={member.user_id} className="flex items-center justify-between gap-3">
                <span>
                  {member.display_name ?? member.email ?? "Guest"}
                  <span className="text-muted-foreground"> · {roleLabel(member.role)}</span>
                </span>
                <button
                  type="button"
                  className="cursor-pointer text-xs text-muted-foreground hover:text-foreground"
                  disabled={busy}
                  onClick={() => void run(async () => {
                    await revokeCloudAccess(client, itemId, { userId: member.user_id });
                    return null;
                  })}
                >
                  Remove
                </button>
              </li>
            ))}
            {sharing.invitations.map((invitation) => (
              <li key={invitation.id} className="flex items-center justify-between gap-3">
                <span>
                  {invitation.email}
                  <span className="text-muted-foreground"> · invited, {roleLabel(invitation.role)}</span>
                </span>
                <button
                  type="button"
                  className="cursor-pointer text-xs text-muted-foreground hover:text-foreground"
                  disabled={busy}
                  onClick={() => void run(async () => {
                    await revokeCloudAccess(client, itemId, { invitationId: invitation.id });
                    return null;
                  })}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {notice ? <p className="text-xs text-muted-foreground" role="status">{notice}</p> : null}
      {error ? <p className="text-xs text-destructive" role="alert">{error}</p> : null}
    </div>
  );
}

/**
 * The Share sheet is one of the three places sign-in lives. Signed out, it
 * is the sign-in card. Signed in, it offers to sync the file's folder, waits
 * for the upload, or shows the sharing panel for a note that is in Cloud.
 */
export function ShareSheet({
  open,
  onClose,
  client,
  account,
  filePath,
  root,
  cloudItemId,
  webAppUrl = GHOST_WEB_URL,
  signIn,
  onSyncFolder,
  onCopyToNotes,
}: {
  open: boolean;
  onClose: () => void;
  client: SupabaseClient | null;
  account: CloudAccountState;
  filePath: string | null;
  root: TrackedRoot | null;
  /** The note's Cloud ID once it is in Cloud; null while it is resolving or not uploaded. */
  cloudItemId?: string | null;
  webAppUrl?: string;
  signIn: SignInSurfaceProps;
  onSyncFolder: (path: string) => void;
  onCopyToNotes: (filePath: string) => void;
}) {
  if (!open) return null;
  const fileName = filePath ? nameOf(filePath) : "this note";
  const folderName = root ? nameOf(root.path) : null;

  let title: string;
  let body: React.ReactNode;
  let footer: React.ReactNode;

  if (!client) {
    title = "Sharing isn't available";
    body = (
      <DialogDescription>
        This build of Ghost has no Cloud configured, so notes stay on this Mac.
      </DialogDescription>
    );
    footer = <Button variant="outline" onClick={onClose}>Close</Button>;
  } else if (account.kind === "signed-out" || account.kind === "loading" || account.kind === "error") {
    title = "Sign in to share";
    body = (
      <>
        <DialogDescription>
          Sharing and your phone need an account. Your notes stay where they are; signing
          in only adds Cloud on top.
        </DialogDescription>
        <div className="mt-2" data-share-sign-in>
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
    );
    footer = <Button variant="outline" onClick={onClose}>Not now</Button>;
  } else if (root && root.kind === "mirrored") {
    title = `Share ${fileName}`;
    body = cloudItemId ? (
      <>
        <DialogDescription>
          It is on your phone at {webAppUrl}, signed in as {account.user.email ?? "you"}.
        </DialogDescription>
        <SharePanel client={client} itemId={cloudItemId} webAppUrl={webAppUrl} />
      </>
    ) : (
      <DialogDescription>
        {folderName ? `${folderName} is on its way to Cloud. ` : ""}
        Sharing opens as soon as {fileName} is there.
      </DialogDescription>
    );
    footer = <Button variant="outline" onClick={onClose}>Done</Button>;
  } else {
    title = `Share ${fileName}`;
    body = (
      <DialogDescription>
        {folderName
          ? `To share ${fileName}, sync ${folderName} to Cloud. The folder stays where it is. Or copy the note into Notes and share it from there.`
          : `Copy ${fileName} into Notes to share it from there.`}
      </DialogDescription>
    );
    footer = (
      <>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        {filePath ? (
          <Button variant="outline" onClick={() => { onClose(); onCopyToNotes(filePath); }}>
            Copy to Notes
          </Button>
        ) : null}
        {root && folderName ? (
          <Button onClick={() => { onClose(); onSyncFolder(root.path); }}>
            Sync {folderName}
          </Button>
        ) : null}
      </>
    );
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent data-share-sheet>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {body}
        </DialogHeader>
        <DialogFooter>{footer}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
