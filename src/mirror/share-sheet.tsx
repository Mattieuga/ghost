import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CloudAccountState } from "@/cloud/use-cloud-account";
import { CloudSignIn } from "@/cloud/cloud-sign-in";
import {
  getCloudItemSharing,
  isMissingSharingFunction,
  revokeCloudAccess,
  sendShareInvitation,
  setCloudShareLink,
  shareCloudItem,
  shareLinkUrl,
  type CloudItemSharing,
  type CloudShareRole,
} from "@/cloud/cloud-sharing";
import type { TrackedRoot } from "@/hooks/use-tracked-folders";
import { SettingRow, SettingSelect, SettingSwitch } from "@/components/settings/setting-row";
import { Button } from "@/components/ui/button";
import { FloatingPanel } from "@/components/ui/floating-panel";
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

/** What the Share sheet is about: a note or a folder, by path. */
export interface ShareTarget {
  path: string;
  kind: "file" | "folder";
}

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

/** The item's name, set off from the rest of the title. */
function ItemPill({ name }: { name: string }) {
  return (
    <span className="ml-1 inline-block max-w-[18rem] truncate rounded-md bg-accent px-2 py-0.5 align-baseline font-mono text-[13px] font-normal text-accent-foreground">
      {name}
    </span>
  );
}

const ROLE_OPTIONS: Array<{ value: CloudShareRole; label: string }> = [
  { value: "viewer", label: "Can view" },
  { value: "editor", label: "Can edit" },
];

/**
 * Sharing for one item, built from the same rows as Settings and shaped
 * like a shared document: one link that is off or on at a role, and
 * people invited by email. The rows are always present so the sheet keeps
 * its height while the item reaches Cloud and while the summary loads.
 * Every change reloads the summary from the server so the sheet never
 * shows access that was not granted.
 */
export function SharePanel({
  client,
  itemId,
  itemName,
  itemKind,
  webAppUrl,
  copy = copyText,
}: {
  client: SupabaseClient;
  /** Null while the item is still on its way to Cloud. */
  itemId: string | null;
  itemName: string;
  itemKind: "document" | "folder";
  webAppUrl: string;
  copy?: (text: string) => Promise<void>;
}) {
  const [sharing, setSharing] = useState<CloudItemSharing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<CloudShareRole>("editor");

  const reload = useCallback(async () => {
    if (!itemId) return;
    try {
      setSharing(await getCloudItemSharing(client, itemId));
      setError(null);
    } catch (reason) {
      setError(messageOf(reason));
    }
  }, [client, itemId]);

  useEffect(() => { void reload(); }, [reload]);

  const ready = itemId !== null && sharing !== null;
  const run = async (work: (id: string) => Promise<void>) => {
    if (!itemId) return;
    setBusy(true);
    setError(null);
    try {
      await work(itemId);
      await reload();
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  const link = sharing?.link ?? null;
  const linkUrl = link ? shareLinkUrl(link.token, webAppUrl) : null;
  const copyUrl = async (url: string) => {
    await copy(url);
    setCopied(true);
  };
  const toggleLink = (on: boolean) => {
    void run(async (id) => {
      const next = await setCloudShareLink(client, id, on ? "viewer" : null);
      if (next) await copyUrl(shareLinkUrl(next.token, webAppUrl));
    });
  };
  const setLinkRole = (role: CloudShareRole) => {
    void run(async (id) => { await setCloudShareLink(client, id, role); });
  };

  const invite = (event: React.FormEvent) => {
    event.preventDefault();
    const email = inviteEmail.trim();
    if (!email) return;
    void run(async (id) => {
      const outcome = await shareCloudItem(client, id, email, inviteRole);
      setInviteEmail("");
      // The email is best effort: access exists either way.
      await sendShareInvitation(client, {
        itemId: id,
        itemName,
        itemKind,
        email: outcome.email,
        role: outcome.role,
        webAppUrl,
      }).catch(() => false);
    });
  };

  return (
    <div className="space-y-4 text-sm" data-share-panel>
      <div className="rounded-xl border bg-card p-6 space-y-4">
        <SettingRow label="Anyone with the link" description={itemId ? undefined : `Getting ${itemName} into Cloud…`}>
          <SettingSwitch
            label="Anyone with the link"
            checked={link !== null}
            disabled={busy || !ready}
            onChange={toggleLink}
          />
        </SettingRow>
        {linkUrl ? (
          <div className="flex items-center gap-2" data-share-link>
            <div className="flex h-8 min-w-0 flex-1 items-center rounded-md border border-input bg-background pl-2.5">
              <span className="truncate font-mono text-xs text-muted-foreground" title={linkUrl}>{linkUrl}</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => void copyUrl(linkUrl).catch((reason: unknown) => setError(messageOf(reason)))}
                className="ml-auto h-full shrink-0 cursor-pointer border-l border-input px-2.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <SettingSelect
              label="Link access"
              value={link?.role ?? "viewer"}
              options={ROLE_OPTIONS}
              disabled={busy}
              onChange={setLinkRole}
            />
          </div>
        ) : null}
      </div>

      <div className="rounded-xl border bg-card p-6 space-y-4">
        <SettingRow label="People" />
        <form className="flex gap-2" onSubmit={invite}>
          <Input
            type="email"
            placeholder="name@example.com"
            aria-label="Email address"
            value={inviteEmail}
            disabled={!ready}
            onChange={(event) => setInviteEmail(event.target.value)}
            className="h-8 flex-1"
          />
          <SettingSelect
            label="Access"
            value={inviteRole}
            options={ROLE_OPTIONS}
            disabled={!ready}
            onChange={setInviteRole}
          />
          <Button size="sm" type="submit" disabled={busy || !ready || !inviteEmail.trim()}>Invite</Button>
        </form>
        {sharing?.members.map((member) => (
          <SettingRow
            key={member.user_id}
            label={member.display_name ?? member.email ?? "Guest"}
            description={roleLabel(member.role)}
          >
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void run(async (id) => {
                await revokeCloudAccess(client, id, { userId: member.user_id });
              })}
            >
              Remove
            </Button>
          </SettingRow>
        ))}
        {sharing?.invitations.map((invitation) => (
          <SettingRow
            key={invitation.id}
            label={invitation.email}
            description={`Invited, ${roleLabel(invitation.role)}`}
          >
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void run(async (id) => {
                await revokeCloudAccess(client, id, { invitationId: invitation.id });
              })}
            >
              Remove
            </Button>
          </SettingRow>
        ))}
      </div>

      {error ? <p className="px-1 text-xs text-destructive" role="alert">{error}</p> : null}
    </div>
  );
}

/**
 * The Share sheet is one of the three places sign-in lives. Signed out, it
 * is the sign-in card. Signed in, it offers to sync the item's folder, or
 * shows the sharing panel for something in a synced folder.
 */
export function ShareSheet({
  open,
  onClose,
  client,
  account,
  target,
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
  target: ShareTarget | null;
  root: TrackedRoot | null;
  /** The item's Cloud ID once it is in Cloud; null while it is resolving or not uploaded. */
  cloudItemId?: string | null;
  webAppUrl?: string;
  signIn: SignInSurfaceProps;
  onSyncFolder: (path: string) => void;
  onCopyToNotes: (filePath: string) => void;
}) {
  if (!open) return null;
  const itemName = target ? nameOf(target.path) : "this note";
  const folderName = root ? nameOf(root.path) : null;

  let title: React.ReactNode;
  let ariaLabel: string;
  let description: React.ReactNode = null;
  let body: React.ReactNode = null;
  let footer: React.ReactNode = null;

  if (!client) {
    title = ariaLabel = "Sharing isn't available";
    description = "This build of Ghost has no Cloud configured, so notes stay on this Mac.";
  } else if (account.kind === "signed-out" || account.kind === "loading" || account.kind === "error") {
    title = ariaLabel = "Sign in to share";
    description = "Sharing and your phone need an account. Your notes stay where they are; signing in only adds Cloud on top.";
    body = (
      <div className="rounded-xl border bg-card p-6 [&>div]:max-w-none [&>div]:border-0 [&>div]:bg-transparent [&>div]:p-0 [&>div]:shadow-none" data-share-sign-in>
        <CloudSignIn
          client={client}
          emailRedirectTo={signIn.emailRedirectTo}
          oauthRedirectTo={signIn.oauthRedirectTo}
          openOAuthUrl={signIn.openOAuthUrl}
          externalError={account.kind === "error" ? account.message : signIn.externalError}
          onCallbackUrl={signIn.completeCallback}
        />
      </div>
    );
  } else if (root && root.kind === "mirrored") {
    title = <>Share <ItemPill name={itemName} /></>;
    ariaLabel = `Share ${itemName}`;
    body = (
      <SharePanel
        client={client}
        itemId={cloudItemId ?? null}
        itemName={itemName}
        itemKind={target?.kind === "folder" ? "folder" : "document"}
        webAppUrl={webAppUrl}
      />
    );
  } else {
    title = <>Share <ItemPill name={itemName} /></>;
    ariaLabel = `Share ${itemName}`;
    description = target?.kind === "folder"
      ? `To share ${itemName}, sync it to Cloud. The folder stays where it is.`
      : folderName
        ? `To share ${itemName}, sync ${folderName} to Cloud. The folder stays where it is. Or copy the note into Notes and share it from there.`
        : `Copy ${itemName} into Notes to share it from there.`;
    footer = (
      <>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        {target?.kind === "file" ? (
          <Button variant="outline" onClick={() => { onClose(); onCopyToNotes(target.path); }}>
            Copy to Notes
          </Button>
        ) : null}
        {target?.kind === "folder" ? (
          <Button onClick={() => { onClose(); onSyncFolder(target.path); }}>
            Sync {itemName}
          </Button>
        ) : root && folderName ? (
          <Button onClick={() => { onClose(); onSyncFolder(root.path); }}>
            Sync {folderName}
          </Button>
        ) : null}
      </>
    );
  }

  // The same panel as Settings, with the same cards inside.
  return (
    <FloatingPanel title={title} ariaLabel={ariaLabel} description={description} onClose={onClose} footer={footer} width={560} data-share-sheet>
      {body ?? <div className="text-xs text-muted-foreground">Nothing to share here.</div>}
    </FloatingPanel>
  );
}
