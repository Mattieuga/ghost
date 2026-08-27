import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Underline from "@tiptap/extension-underline";
import Highlight from "@tiptap/extension-highlight";
import { TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { Focus } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { Redo2, Undo2 } from "lucide-react";
import * as Y from "yjs";
import { ResizableTable } from "@/components/editor/table-extension";
import { Frontmatter } from "@/components/editor/frontmatter-extension";
import { CollapsibleHeadings } from "@/components/editor/collapsible-headings";
import { SupabaseCloudAdapter } from "@/cloud/collaboration/supabase-cloud-adapter";
import type {
  CloudCollaborationSession,
  CloudCollaborationSnapshot,
} from "@/cloud/collaboration/types";
import { CloudAccessError } from "@/cloud/collaboration/types";
import {
  openCloudLocalPersistence,
  type CloudLocalPersistenceHandle,
} from "@/cloud/cloud-local-persistence";
import { CloudVersionHistory } from "@/cloud/cloud-version-history-panel";
import { Button } from "@/components/ui/button";
import "@/components/editor/editor-styles.css";

type BootState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
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
}: {
  client: SupabaseClient;
  user: User;
  documentId: string;
  title: string;
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
      try {
        session = await SupabaseCloudAdapter.create({
          client,
          document,
          documentId,
          user: collaborationIdentity(user),
        });
      } catch (reason) {
        if (reason instanceof CloudAccessError) await localPersistence.clear();
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
    return <CloudEditorNotice>Loading {title}…</CloudEditorNotice>;
  }
  if (boot.kind === "error") {
    return <CloudEditorNotice error>{boot.message}</CloudEditorNotice>;
  }
  return (
    <CollaborativeSurface
      client={client}
      documentId={documentId}
      localPersistence={boot.localPersistence}
      session={boot.session}
      title={title}
    />
  );
}

function CollaborativeSurface({
  client,
  documentId,
  localPersistence,
  session,
  title,
}: {
  client: SupabaseClient;
  documentId: string;
  localPersistence: CloudLocalPersistenceHandle;
  session: CloudCollaborationSession;
  title: string;
}) {
  const [snapshot, setSnapshot] = useState<CloudCollaborationSnapshot>(session.getSnapshot());
  const [presence, setPresence] = useState<string[]>([]);
  const [, setHistoryRevision] = useState(0);
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

  const editor = useEditor({
    editable: session.role === "editor",
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5, 6] },
        link: false,
        trailingNode: false,
        underline: false,
        undoRedo: false,
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        isAllowedUri: (url, context) => url.startsWith("#") || context.defaultValidate(url),
      }),
      Image.configure({ allowBase64: false }),
      Focus.configure({ className: "has-focus", mode: "deepest" }),
      Markdown.configure({
        indentation: { style: "space", size: 2 },
        markedOptions: { gfm: true },
      }),
      Underline,
      Highlight,
      ResizableTable.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      Frontmatter,
      CollapsibleHeadings,
      Collaboration.configure({
        document: session.document,
        field: "default",
        // The collaboration extension always adds its own local binding origin.
        // Keeping this list empty makes undo/redo ignore remote and persistence
        // transactions while retaining the current user's editor changes.
        yUndoOptions: { trackedOrigins: [] },
      }),
      CollaborationCaret.configure({
        provider: session,
        user: session.awareness.getLocalState()?.user,
      }),
    ],
    editorProps: { attributes: { class: "ghost-editor" } },
  });

  useEffect(() => {
    if (!editor) return;
    const refresh = () => setHistoryRevision((revision) => revision + 1);
    editor.on("transaction", refresh);
    return () => { editor.off("transaction", refresh); };
  }, [editor]);

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

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex min-h-12 flex-wrap items-center gap-2 border-b border-border px-4 py-2 text-[11px] text-muted-foreground">
        <strong className="mr-2 truncate text-sm text-foreground">{title}</strong>
        <CloudStatus label="Realtime" value={snapshot.connection} />
        <CloudStatus label="Sync" value={snapshot.synchronization} />
        <CloudStatus label="Cloud" value={snapshot.durability} />
        <CloudStatus label="Local" value={localPersistence.status} />
        <span className="rounded-full bg-secondary px-2 py-1">{snapshot.role}</span>
        {editor && session.role === "editor" ? (
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon-xs"
              title="Undo your last change"
              disabled={!editor.can().undo()}
              onClick={() => editor.chain().focus().undo().run()}
            >
              <Undo2 />
              <span className="sr-only">Undo</span>
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              title="Redo your last change"
              disabled={!editor.can().redo()}
              onClick={() => editor.chain().focus().redo().run()}
            >
              <Redo2 />
              <span className="sr-only">Redo</span>
            </Button>
          </div>
        ) : null}
        {editor ? (
          <CloudVersionHistory
            client={client}
            documentId={documentId}
            editor={editor}
            session={session}
          />
        ) : null}
        <span className="ml-auto truncate">Here: {presence.join(", ") || "you"}</span>
      </div>
      {localPersistence.message ? (
        <div className="border-b border-amber-400/30 bg-amber-400/10 px-4 py-2 text-xs text-amber-300">
          Local recovery is unavailable: {localPersistence.message}
        </div>
      ) : null}
      {snapshot.lastError ? (
        <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">
          {snapshot.lastError}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto min-h-full max-w-[var(--editor-max-width,800px)] px-8 pb-32 pt-14">
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}

function CloudStatus({ label, value }: { label: string; value: string }) {
  const healthy = value === "connected" || value === "saved" || value === "synced" || value === "ready";
  return (
    <span className="flex items-center gap-1 rounded-full bg-secondary px-2 py-1">
      <span className={`size-1.5 rounded-full ${healthy ? "bg-emerald-400" : "bg-amber-400"}`} />
      {label}: {value}
    </span>
  );
}

function CloudEditorNotice({
  children,
  error = false,
}: {
  children: React.ReactNode;
  error?: boolean;
}) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <p className={error ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>{children}</p>
    </div>
  );
}
