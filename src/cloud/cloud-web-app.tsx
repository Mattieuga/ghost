import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getBrowserCloudClient } from "@/cloud/browser-cloud-client";
import { CloudSignIn } from "@/cloud/cloud-sign-in";
import { CloudTree } from "@/cloud/cloud-tree";
import { CloudDocumentEditor } from "@/cloud/cloud-document-editor";
import { useCloudAccount } from "@/cloud/use-cloud-account";
import { useCloudTree } from "@/cloud/use-cloud-tree";
import { cloudItemPath } from "@/cloud/cloud-data";
import {
  redeemCloudShareLink,
  setCloudDisplayName,
  shareTokenFromUrl,
  type VisibleCloudItem,
} from "@/cloud/cloud-sharing";
import { AppNotification } from "@/components/ui/app-notification";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * The web client is one page with hash routes, so it works from any static
 * host and the Mac can hand it a link:
 *
 *   #/d/<documentId>   one document, for members and guests alike
 *   #share=<token>     a share link; redeemed once, then replaced by #/d/…
 *
 * Everything else is home. Supabase's PKCE callback uses the query string
 * and is consumed by the client before routing sees it.
 */
export type WebRoute = { kind: "home" } | { kind: "document"; id: string };

export function parseWebRoute(hash: string): WebRoute {
  const match = /^#\/d\/([0-9a-f-]{36})$/i.exec(hash);
  return match ? { kind: "document", id: match[1] } : { kind: "home" };
}

export function documentHash(id: string): string {
  return `#/d/${id}`;
}

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function replaceHash(hash: string) {
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${hash}`);
}

/**
 * A share token outlives the page it arrived on: a magic link opens in a
 * new tab and a guest may sign in later to keep the note. It is kept in
 * session storage until a permanent account has redeemed it. Redeeming is
 * idempotent and never lowers a role, so redeeming twice is safe.
 */
const PENDING_SHARE_KEY = "ghost-cloud-pending-share";

function readPendingShare(): string | null {
  const fromUrl = shareTokenFromUrl(window.location.href);
  if (fromUrl) {
    try { window.sessionStorage.setItem(PENDING_SHARE_KEY, fromUrl); } catch { /* private mode */ }
    return fromUrl;
  }
  try { return window.sessionStorage.getItem(PENDING_SHARE_KEY); } catch { return null; }
}

function clearPendingShare() {
  try { window.sessionStorage.removeItem(PENDING_SHARE_KEY); } catch { /* private mode */ }
}

function isGuestUser(user: { is_anonymous?: boolean } | null): boolean {
  return Boolean(user?.is_anonymous);
}

export function CloudWebApp() {
  const client = useMemo(() => getBrowserCloudClient(), []);
  // Magic links and OAuth come back to this page, whatever it is called on
  // the host: `/app.html` in dev, `/` on the deployed site.
  const emailRedirectTo = useMemo(() => new URL(window.location.pathname, window.location.href).href, []);
  const [shareToken, setShareToken] = useState<string | null>(() => readPendingShare());
  const [route, setRoute] = useState<WebRoute>(() => parseWebRoute(window.location.hash));
  const account = useCloudAccount(client);
  const user = account.kind === "signed-in" ? account.user : null;
  const tree = useCloudTree(client, user);
  const reloadRef = useRef(tree.reload);
  reloadRef.current = tree.reload;
  const [activeDocument, setActiveDocument] = useState<VisibleCloudItem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showStyleBar, setShowStyleBar] = useState(true);
  const missingRouteNoticed = useRef<string | null>(null);
  const activeDocumentPath = activeDocument
    ? cloudItemPath(tree.items, activeDocument).slice(0, -1).map((item) => item.name)
    : [];

  // Back and forward move between documents.
  useEffect(() => {
    const onHashChange = () => {
      if (shareTokenFromUrl(window.location.href)) return;
      setRoute(parseWebRoute(window.location.hash));
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // A share link is redeemed once there is a session, guest or account. The
  // token then leaves the address bar in favour of the document's own route.
  useEffect(() => {
    if (!client || !user || !shareToken) return;
    let cancelled = false;
    void redeemCloudShareLink(client, shareToken)
      .then(({ item }) => {
        if (cancelled) return;
        const next: WebRoute = item.kind === "document" ? { kind: "document", id: item.id } : { kind: "home" };
        replaceHash(next.kind === "document" ? documentHash(next.id) : "");
        setRoute(next);
        // A guest keeps the token so signing in later grants the account too.
        if (!isGuestUser(user)) clearPendingShare();
        void reloadRef.current();
      })
      .catch((reason) => {
        if (cancelled) return;
        replaceHash("");
        setRoute({ kind: "home" });
        clearPendingShare();
        setNotice(messageOf(reason));
      })
      .finally(() => {
        if (!cancelled) setShareToken(null);
      });
    return () => { cancelled = true; };
  }, [client, shareToken, user]);

  // The route decides what is open once the tree can answer for it.
  useEffect(() => {
    if (route.kind === "home") {
      setActiveDocument(null);
      return;
    }
    const item = tree.items.find((candidate) => candidate.id === route.id && candidate.kind === "document");
    if (item) {
      setActiveDocument((current) => (current?.id === item.id ? current : item));
      return;
    }
    if (!tree.loading && tree.items.length > 0 && missingRouteNoticed.current !== route.id) {
      missingRouteNoticed.current = route.id;
      setNotice("That note isn't in your Cloud or shared with you.");
    }
  }, [route, tree.items, tree.loading]);

  const openDocument = useCallback((item: VisibleCloudItem) => {
    setActiveDocument(item);
    if (window.location.hash !== documentHash(item.id)) {
      window.history.pushState(null, "", `${window.location.pathname}${window.location.search}${documentHash(item.id)}`);
    }
    setRoute({ kind: "document", id: item.id });
  }, []);

  const closeDocument = useCallback(() => {
    setActiveDocument(null);
    replaceHash("");
    setRoute({ kind: "home" });
  }, []);

  const renameActiveDocument = async (nextName: string) => {
    if (!activeDocument) return;
    setActiveDocument(await tree.rename(activeDocument.id, nextName));
  };

  if (!client || account.kind === "error") {
    return (
      <FullPageNotice title="Cloud unavailable">
        {account.kind === "error" ? account.message : "Ghost Cloud is not configured."}
      </FullPageNotice>
    );
  }
  if (account.kind === "loading") return <FullPageNotice>Loading your account…</FullPageNotice>;
  if (account.kind === "signed-out") {
    return (
      <main className="flex min-h-svh items-center justify-center overflow-auto bg-background px-6 py-12 text-foreground">
        <div>
          <div className="mb-8 text-center">
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ghost-amber">Ghost</div>
            <h1 className="mt-2 font-serif text-3xl">
              {shareToken || route.kind === "document" ? "Someone shared a note with you." : "Your notes, on the web."}
            </h1>
          </div>
          {shareToken ? <GuestGate client={client} onError={setNotice} /> : null}
          <CloudSignIn client={client} emailRedirectTo={emailRedirectTo} />
          <AppNotification message={notice} onDismiss={() => setNotice(null)} />
        </div>
      </main>
    );
  }

  const accountLabel = tree.guest
    ? `Guest${account.user.user_metadata?.display_name ? ` · ${account.user.user_metadata.display_name}` : ""}`
    : account.user.email ?? "Signed in";

  return (
    <main className="grid h-svh min-h-0 grid-cols-[260px_minmax(0,1fr)] overflow-hidden bg-background text-foreground">
      <CloudTree
        tree={tree}
        selectedId={activeDocument?.id ?? null}
        onSelectDocument={openDocument}
        onItemsDeleted={(itemIds) => {
          if (activeDocument && itemIds.includes(activeDocument.id)) closeDocument();
        }}
        accountLabel={accountLabel}
        onSignOut={() => { void client.auth.signOut(); }}
      />
      <section className="min-h-0 min-w-0">
        {activeDocument ? (
          <CloudDocumentEditor
            key={activeDocument.id}
            client={client}
            user={account.user}
            documentId={activeDocument.id}
            title={activeDocument.name}
            pathSegments={activeDocumentPath}
            onRename={activeDocument.access_role === "viewer" ? undefined : renameActiveDocument}
            showStyleBar={showStyleBar}
            onToggleStyleBar={() => setShowStyleBar((visible) => !visible)}
          />
        ) : (
          <div className="flex h-full items-center justify-center px-8 text-center">
            <div>
              <p className="text-base font-medium">{tree.guest ? "Shared with you" : "Your notes"}</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {tree.guest
                  ? "Pick a note from the list to read or edit it."
                  : "Everything synced from your Mac is here. Pick a note, or press + for a new one."}
              </p>
            </div>
          </div>
        )}
      </section>
      <AppNotification message={notice} onDismiss={() => setNotice(null)} />
    </main>
  );
}

/**
 * A share link without an account: continue as a guest under a name, or
 * sign in below and keep the note for good. Guest sessions are anonymous
 * Supabase users; the note's owner sees the name in presence and the sheet.
 */
function GuestGate({ client, onError }: { client: SupabaseClient; onError: (message: string) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const continueAsGuest = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const displayName = name.trim() || "Guest";
      const { error } = await client.auth.signInAnonymously({
        options: { data: { display_name: displayName } },
      });
      if (error) throw new Error(error.message);
      // The owner's Share sheet lists members from profiles, not metadata.
      await setCloudDisplayName(client, displayName).catch(() => undefined);
    } catch (reason) {
      onError(/anonymous/i.test(messageOf(reason))
        ? "Guest access is off for this Cloud. Sign in below instead."
        : messageOf(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      data-guest-gate
      className="mx-auto mb-6 w-full max-w-sm rounded-xl border border-border bg-card px-5 py-4"
      onSubmit={(event) => { void continueAsGuest(event); }}
    >
      <p className="text-sm font-medium">Open it as a guest</p>
      <p className="mt-1 text-xs text-muted-foreground">Your name shows next to your edits. No account needed.</p>
      <div className="mt-3 flex gap-2">
        <Input
          aria-label="Your name"
          placeholder="Your name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="h-9 flex-1"
        />
        <Button type="submit" disabled={busy}>Continue</Button>
      </div>
      <p className="mt-3 text-center text-xs text-muted-foreground">or sign in to keep it</p>
    </form>
  );
}

function FullPageNotice({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-8 text-foreground">
      <div className="max-w-lg rounded-xl border border-border bg-card px-6 py-5 text-center">
        {title ? <h1 className="mb-2 text-lg font-semibold">{title}</h1> : null}
        <p className="text-sm text-muted-foreground">{children}</p>
      </div>
    </main>
  );
}
