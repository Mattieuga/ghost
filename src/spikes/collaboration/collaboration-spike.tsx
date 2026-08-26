import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import Highlight from "@tiptap/extension-highlight";
import { TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { Focus } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";

import { ResizableImage } from "@/components/editor/image-extension";
import { ResizableTable } from "@/components/editor/table-extension";
import { Frontmatter } from "@/components/editor/frontmatter-extension";
import { CollapsibleHeadings } from "@/components/editor/collapsible-headings";
import { parseMarkdownDocument } from "@/components/editor/frontmatter";
import { serializeMarkdownDocument } from "@/components/editor/markdown-source";
import "@/components/editor/editor-styles.css";
import { getActorSession, readCollaborationSpikeConfig } from "./supabase";
import {
  SupabaseCollaborationAdapter,
  Y_SUPABASE_SPIKE_REVISION,
} from "./supabase-adapter";
import {
  CollaborationAccessError,
  type CollaborationAdapter,
  type CollaborationSnapshot,
} from "./types";
import "./collaboration-spike.css";

const DEFAULT_ROOM_ID = "00000000-0000-4000-8000-000000000001";
const ACTORS = {
  alice: { name: "Alice", color: "#ff6b35" },
  bob: { name: "Bob", color: "#4f8cff" },
  viewer: { name: "Viewer", color: "#a78bfa" },
} as const;
type Actor = keyof typeof ACTORS;

const FIDELITY_FIXTURE = `---
title: Multiplayer fidelity fixture
tags: [cloud, spike]
---

# Shared plan

This paragraph has an [internal link](#tasks), an [external link](https://ghost.org), ==highlighted text==, and <u>underlined text</u>.

## Tasks

- [x] Connect two editors
- [ ] Make a concurrent edit
  - [ ] Reconnect after going offline

| Person | Idea | Status |
| --- | --- | --- |
| Alice | Cloud section | Testing |
| Bob | Markdown export | Next |

![Remote image](https://images.unsplash.com/photo-1455390582262-044cdead277a?w=800)
`;

type BootState =
  | { kind: "loading" }
  | { kind: "missing-config" }
  | { kind: "access"; userId: string }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      adapter: CollaborationAdapter;
      persistence: IndexeddbPersistence;
      userId: string;
    };

function actorFromLocation(): Actor {
  const value = new URLSearchParams(window.location.search).get("actor");
  return value && value in ACTORS ? value as Actor : "alice";
}

function roomFromLocation(): string {
  return new URLSearchParams(window.location.search).get("room") ?? DEFAULT_ROOM_ID;
}

function actorUrl(actor: Actor, roomId: string): string {
  const url = new URL(window.location.href);
  url.searchParams.set("mode", "collaboration-spike");
  url.searchParams.set("actor", actor);
  url.searchParams.set("room", roomId);
  return url.toString();
}

export function CollaborationSpike() {
  const actor = useMemo(actorFromLocation, []);
  const roomId = useMemo(roomFromLocation, []);
  const actorDetails = ACTORS[actor];
  const [boot, setBoot] = useState<BootState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    let adapter: CollaborationAdapter | null = null;
    let persistence: IndexeddbPersistence | null = null;
    let document: Y.Doc | null = null;

    const start = async () => {
      const config = readCollaborationSpikeConfig();
      if (!config) {
        setBoot({ kind: "missing-config" });
        return;
      }

      const session = await getActorSession(config, actor);
      if (cancelled) return;

      document = new Y.Doc();
      persistence = new IndexeddbPersistence(
        `ghost-spike:${config.projectRef}:${roomId}:${actor}`,
        document,
      );
      await persistence.whenSynced;
      if (cancelled) return;

      adapter = await SupabaseCollaborationAdapter.create({
        client: session.client,
        document,
        roomId,
        userId: session.user.id,
        user: actorDetails,
      });
      if (cancelled) {
        await adapter.destroy();
        return;
      }

      setBoot({
        kind: "ready",
        adapter,
        persistence,
        userId: session.user.id,
      });
    };

    void start().catch((error: unknown) => {
      if (cancelled) return;
      if (error instanceof CollaborationAccessError) {
        setBoot({ kind: "access", userId: error.userId });
        return;
      }
      setBoot({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not start collaboration spike.",
      });
    });

    return () => {
      cancelled = true;
      void (async () => {
        await adapter?.destroy();
        persistence?.destroy();
        document?.destroy();
      })();
    };
  }, [actor, actorDetails, roomId]);

  return (
    <main className="collaboration-spike-shell">
      <header className="collaboration-spike-header">
        <div>
          <p className="collaboration-spike-kicker">Ghost Cloud · disposable Phase 0 spike</p>
          <h1>Multiplayer Markdown</h1>
        </div>
        <nav className="collaboration-spike-actors" aria-label="Prototype actors">
          {(Object.keys(ACTORS) as Actor[]).map((candidate) => (
            <a
              key={candidate}
              className={candidate === actor ? "active" : ""}
              href={actorUrl(candidate, roomId)}
              target="_blank"
              rel="noreferrer"
            >
              {ACTORS[candidate].name}
            </a>
          ))}
        </nav>
      </header>

      {boot.kind === "loading" && <SpikeNotice title="Connecting">Preparing the local cache and Supabase session…</SpikeNotice>}
      {boot.kind === "missing-config" && <MissingConfig />}
      {boot.kind === "access" && <AccessSetup actor={actor} roomId={roomId} userId={boot.userId} />}
      {boot.kind === "error" && <SpikeNotice title="Prototype could not start">{boot.message}</SpikeNotice>}
      {boot.kind === "ready" && (
        <CollaborativeEditor
          key={`${actor}:${roomId}`}
          actor={actor}
          adapter={boot.adapter}
          userId={boot.userId}
        />
      )}
    </main>
  );
}

function CollaborativeEditor({
  actor,
  adapter,
  userId,
}: {
  actor: Actor;
  adapter: CollaborationAdapter;
  userId: string;
}) {
  const [snapshot, setSnapshot] = useState<CollaborationSnapshot>(adapter.getSnapshot());
  const [markdown, setMarkdown] = useState("");
  const [presence, setPresence] = useState<string[]>([ACTORS[actor].name]);
  const seeded = useRef(false);

  useEffect(() => adapter.subscribe(setSnapshot), [adapter]);
  useEffect(() => {
    const refresh = () => {
      const names = Array.from(adapter.awareness.getStates().values())
        .map((state) => state?.user?.name)
        .filter((name): name is string => typeof name === "string");
      setPresence(Array.from(new Set(names)));
    };
    refresh();
    adapter.awareness.on("change", refresh);
    return () => adapter.awareness.off("change", refresh);
  }, [adapter]);

  const editor = useEditor({
    editable: adapter.role === "editor",
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
      Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true }),
      ResizableImage.configure({ allowBase64: true }),
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
      Collaboration.configure({ document: adapter.document, field: "default" }),
      CollaborationCaret.configure({ provider: adapter, user: ACTORS[actor] }),
    ],
    editorProps: { attributes: { class: "ghost-editor" } },
    onUpdate: ({ editor: currentEditor }) => {
      try {
        setMarkdown(serializeMarkdownDocument(currentEditor));
      } catch {
        setMarkdown("Markdown serialization failed for the current collaborative state.");
      }
    },
  });

  useEffect(() => {
    if (!editor || seeded.current) return;
    seeded.current = true;
    try {
      setMarkdown(serializeMarkdownDocument(editor));
    } catch {
      setMarkdown("");
    }
  }, [editor]);

  const loadFixture = () => {
    if (!editor || adapter.role !== "editor" || !editor.isEmpty) return;
    editor.commands.setContent(parseMarkdownDocument(editor, FIDELITY_FIXTURE));
  };

  return (
    <section className="collaboration-spike-workspace">
      <div className="collaboration-spike-statusbar">
        <StatusPill label="Realtime" value={snapshot.connection} />
        <StatusPill label="Sync" value={snapshot.synchronization} />
        <StatusPill label="Database" value={snapshot.durability} />
        <span className="collaboration-spike-role">{adapter.role}</span>
        <span className="collaboration-spike-presence">Here: {presence.join(", ") || "you"}</span>
      </div>

      {snapshot.lastError && <div className="collaboration-spike-error">{snapshot.lastError}</div>}

      <div className="collaboration-spike-panes">
        <article className="collaboration-spike-editor-pane">
          {editor?.isEmpty && adapter.role === "editor" && (
            <button type="button" className="collaboration-spike-seed" onClick={loadFixture}>
              Load Markdown fidelity fixture
            </button>
          )}
          <EditorContent editor={editor} className="collaboration-spike-editor" />
        </article>
        <aside className="collaboration-spike-markdown-pane">
          <div className="collaboration-spike-pane-title">Derived Markdown</div>
          <pre>{markdown || "Start typing to inspect the Markdown export."}</pre>
        </aside>
      </div>

      <footer className="collaboration-spike-footer">
        <span>User {userId}</span>
        <span>{Y_SUPABASE_SPIKE_REVISION}</span>
      </footer>
    </section>
  );
}

function StatusPill({ label, value }: { label: string; value: string }) {
  return <span className={`collaboration-spike-pill status-${value}`}><b>{label}</b> {value}</span>;
}

function SpikeNotice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="collaboration-spike-notice">
      <h2>{title}</h2>
      <div>{children}</div>
    </section>
  );
}

function MissingConfig() {
  return (
    <SpikeNotice title="Supabase connection needed">
      <p>Create <code>.env.local</code> with the project values from Supabase’s Connect dialog:</p>
      <pre>{`VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...`}</pre>
      <p>The publishable key is designed for client apps. Do not put a secret or service-role key here.</p>
    </SpikeNotice>
  );
}

function AccessSetup({
  actor,
  roomId,
  userId,
}: {
  actor: Actor;
  roomId: string;
  userId: string;
}) {
  const role = actor === "viewer" ? "viewer" : "editor";
  const sql = `insert into public.collaboration_spike_members (room_id, user_id, role)
values ('${roomId}', '${userId}', '${role}')
on conflict (room_id, user_id) do update set role = excluded.role;`;

  return (
    <SpikeNotice title={`${ACTORS[actor].name} is authenticated but not assigned`}>
      <p>Run this in the Supabase SQL editor, then reload this window:</p>
      <pre>{sql}</pre>
      <p>Open Alice, Bob, and Viewer once each so every isolated prototype identity gets a UUID.</p>
    </SpikeNotice>
  );
}
