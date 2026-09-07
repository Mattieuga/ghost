import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import * as Y from "yjs";
import { SupabaseCloudAdapter } from "@/cloud/collaboration/supabase-cloud-adapter";
import type {
  CloudCollaborationSession,
  CloudCollaborationSnapshot,
} from "@/cloud/collaboration/types";
import { CloudAccessError } from "@/cloud/collaboration/types";
import { PresenceAvatars } from "@/cloud/presence-avatars";
import {
  openCloudLocalPersistence,
  type CloudLocalPersistenceHandle,
} from "@/cloud/cloud-local-persistence";
import { CloudVersionHistory } from "@/cloud/cloud-version-history-panel";
import { DocumentHeader } from "@/components/editor/document-header";
import { HeadingMinimap } from "@/components/editor/heading-minimap";
import {
  MarkdownEditor,
  type MarkdownEditorPlatformActions,
} from "@/components/editor/markdown-editor";
import { AppNotification } from "@/components/ui/app-notification";

type BootState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "revoked" }
  | {
    kind: "ready";
    session: CloudCollaborationSession;
    localPersistence: CloudLocalPersistenceHandle;
  };

const COLORS = ["#ff7145", "#5ba8ff", "#76c98f", "#d68cff", "#f4bd50"];

function collaborationIdentity(user: User) {
  let hash = 0;
  for (const character of user.id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return {
    name: user.user_metadata?.display_name
      ?? user.email?.split("@")[0]
      ?? "Ghost user",
    color: COLORS[hash % COLORS.length],
  };
}

export function CloudDocumentEditor({
  client,
  user,
  documentId,
  title,
  pathSegments = [],
  onRename,
  onAccessLost,
  showStyleBar = true,
  onToggleStyleBar,
  sidebarCollapsed = false,
  platformActions,
}: {
  client: SupabaseClient;
  user: User;
  documentId: string;
  title: string;
  pathSegments?: string[];
  onRename?: (nextName: string) => void | Promise<void>;
  /** The share ended while the note was open, or it was already gone when opening. */
  onAccessLost?: () => void;
  showStyleBar?: boolean;
  onToggleStyleBar?: () => void;
  sidebarCollapsed?: boolean;
  platformActions?: MarkdownEditorPlatformActions;
}) {
  const [boot, setBoot] = useState<BootState>({ kind: "loading" });

  useEffect(() => {
    let active = true;
    let session: CloudCollaborationSession | null = null;
    let localPersistence: CloudLocalPersistenceHandle | null = null;
    const document = new Y.Doc();
    setBoot({ kind: "loading" });

    const start = async () => {
      localPersistence = await openCloudLocalPersistence(user.id, documentId, document);
      if (!active) {
        await localPersistence.destroy().catch(() => undefined);
        return;
      }
      const adapterOptions = {
        client,
        document,
        documentId,
        user: collaborationIdentity(user),
        onRoleVerified: (role: CloudCollaborationSnapshot["role"]) => (
          localPersistence?.rememberRole(role)
        ),
        onAccessRevoked: async () => {
          await localPersistence?.clear().catch(() => undefined);
          await session?.destroy().catch(() => undefined);
          if (active) setBoot({ kind: "revoked" });
        },
      };
      try {
        if (localPersistence.status === "ready" && localPersistence.cachedRole) {
          session = SupabaseCloudAdapter.createFromCache(
            adapterOptions,
            localPersistence.cachedRole,
          );
        } else {
          session = await SupabaseCloudAdapter.create(adapterOptions);
          await localPersistence.rememberRole(session.role).catch(() => undefined);
        }
      } catch (reason) {
        if (reason instanceof CloudAccessError) {
          await localPersistence.clear();
          if (active) setBoot({ kind: "revoked" });
          return;
        }
        throw reason;
      }
      if (!active) {
        await session.destroy();
        return;
      }
      setBoot({ kind: "ready", session, localPersistence });
    };

    void start().catch((reason: unknown) => {
      if (active) setBoot({
        kind: "error",
        message: reason instanceof Error ? reason.message : String(reason),
      });
    });

    return () => {
      active = false;
      void (async () => {
        await session?.destroy();
        await localPersistence?.destroy();
        document.destroy();
      })();
    };
  }, [client, documentId, user.id, user.email, user.user_metadata?.display_name]);

  if (boot.kind === "loading") {
    return (
      <CloudEditorNotice
        title={title}
        pathSegments={pathSegments}
        onRename={onRename}
        sidebarCollapsed={sidebarCollapsed}
      >
        Loading {title}…
      </CloudEditorNotice>
    );
  }
  if (boot.kind === "revoked") {
    return (
      <CloudEditorNotice
        title={title}
        pathSegments={pathSegments}
        sidebarCollapsed={sidebarCollapsed}
      >
        <span data-cloud-revoked>This note is no longer shared with you.</span>
        {onAccessLost ? (
          <button
            type="button"
            className="ml-3 cursor-pointer rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
            onClick={onAccessLost}
          >
            Back to your notes
          </button>
        ) : null}
      </CloudEditorNotice>
    );
  }
  if (boot.kind === "error") {
    return (
      <CloudEditorNotice
        error
        title={title}
        pathSegments={pathSegments}
        onRename={onRename}
        sidebarCollapsed={sidebarCollapsed}
      >
        {boot.message}
      </CloudEditorNotice>
    );
  }
  return (
    <CollaborativeSurface
      client={client}
      documentId={documentId}
      localPersistence={boot.localPersistence}
      session={boot.session}
      title={title}
      pathSegments={pathSegments}
      onRename={onRename}
      showStyleBar={showStyleBar}
      onToggleStyleBar={onToggleStyleBar}
      sidebarCollapsed={sidebarCollapsed}
      platformActions={platformActions}
    />
  );
}

function CollaborativeSurface({
  client,
  documentId,
  localPersistence,
  session,
  title,
  pathSegments,
  onRename,
  showStyleBar,
  onToggleStyleBar,
  sidebarCollapsed,
  platformActions,
}: {
  client: SupabaseClient;
  documentId: string;
  localPersistence: CloudLocalPersistenceHandle;
  session: CloudCollaborationSession;
  title: string;
  pathSegments: string[];
  onRename?: (nextName: string) => void | Promise<void>;
  showStyleBar: boolean;
  onToggleStyleBar?: () => void;
  sidebarCollapsed: boolean;
  platformActions?: MarkdownEditorPlatformActions;
}) {
  const [snapshot, setSnapshot] = useState<CloudCollaborationSnapshot>(session.getSnapshot());
  const [presence, setPresence] = useState<string[]>([]);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [scrollContainer, setScrollContainer] = useState<HTMLElement | null>(null);
  const [notification, setNotification] = useState<string | null>(null);
  const lastNotificationRef = useRef<string | null>(null);
  const flushRef = useRef(session.flush.bind(session));
  flushRef.current = session.flush.bind(session);

  useEffect(() => session.subscribe(setSnapshot), [session]);
  useEffect(() => {
    const refresh = () => {
      const names = Array.from(session.awareness.getStates().values())
        .map((state) => state?.user?.name)
        .filter((name): name is string => typeof name === "string");
      setPresence(Array.from(new Set(names)));
    };
    refresh();
    session.awareness.on("change", refresh);
    return () => session.awareness.off("change", refresh);
  }, [session]);

  useEffect(() => {
    const flush = () => { void flushRef.current().catch(() => undefined); };
    window.addEventListener("blur", flush);
    const flushCloudSave = () => flushRef.current();
    window.__ghostFlushCloudSave = flushCloudSave;
    return () => {
      window.removeEventListener("blur", flush);
      if (window.__ghostFlushCloudSave === flushCloudSave) delete window.__ghostFlushCloudSave;
    };
  }, []);

  useEffect(() => {
    const message = snapshot.lastError
      ?? (localPersistence.message ? `Local recovery is unavailable: ${localPersistence.message}` : null);
    if (!message) {
      lastNotificationRef.current = null;
      setNotification(null);
      return;
    }
    if (message !== lastNotificationRef.current) {
      lastNotificationRef.current = message;
      setNotification(message);
    }
  }, [localPersistence.message, snapshot.lastError]);

  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-background">
      <DocumentHeader
        pathSegments={pathSegments}
        fileName={title}
        onRename={snapshot.role === "editor" ? onRename : undefined}
        sidebarCollapsed={sidebarCollapsed}
        right={(
          <>
            <CloudSaveStatus snapshot={snapshot} />
            <PresenceAvatars names={presence} />
            {editor ? (
              <CloudVersionHistory
                client={client}
                documentId={documentId}
                editor={editor}
                networkReady={snapshot.synchronization === "synced"}
                session={session}
              />
            ) : null}
          </>
        )}
      />
      <AppNotification message={notification} onDismiss={() => setNotification(null)} />
      <main
        ref={setScrollContainer}
        data-editor-scroll-container
        className="h-full overflow-auto overscroll-contain outline-none"
      >
        <MarkdownEditor
          collaboration={{
            document: session.document,
            provider: session,
            user: session.awareness.getLocalState()?.user ?? {},
          }}
          editable={snapshot.role === "editor"}
          showStyleBar={showStyleBar}
          onToggleStyleBar={onToggleStyleBar}
          onEditorReady={setEditor}
          platformActions={platformActions}
        />
      </main>
      {editor && scrollContainer ? (
        <HeadingMinimap editor={editor} scrollContainer={scrollContainer} />
      ) : null}
    </div>
  );
}

function CloudSaveStatus({ snapshot }: { snapshot: CloudCollaborationSnapshot }) {
  if (snapshot.lastError || snapshot.durability === "error") {
    return <span className="text-[11px] text-destructive">Save failed</span>;
  }
  if (snapshot.role === "viewer") {
    return <span className="text-[11px] text-ring/65">View only</span>;
  }
  if (snapshot.synchronization === "offline" || snapshot.connection === "disconnected") {
    return <span className="text-[11px] text-ring/65">Offline</span>;
  }
  if (snapshot.durability === "pending" || snapshot.durability === "saving") {
    return <span className="text-[11px] text-ring">Saving…</span>;
  }
  if (snapshot.durability === "saved" && snapshot.synchronization === "synced") {
    return <span className="text-[11px] text-ring/65">Saved</span>;
  }
  return <span className="text-[11px] text-ring/65">Connecting…</span>;
}

function CloudEditorNotice({
  children,
  error = false,
  title,
  pathSegments,
  onRename,
  sidebarCollapsed,
}: {
  children: React.ReactNode;
  error?: boolean;
  title: string;
  pathSegments: string[];
  onRename?: (nextName: string) => void | Promise<void>;
  sidebarCollapsed: boolean;
}) {
  return (
    <div className="relative flex h-full items-center justify-center p-8">
      <DocumentHeader
        pathSegments={pathSegments}
        fileName={title}
        onRename={onRename}
        sidebarCollapsed={sidebarCollapsed}
      />
      <p className={error ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>{children}</p>
    </div>
  );
}
