import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { GhostIndexEntry } from "@/lib/mirror/ghost-index";
import { listen } from "@tauri-apps/api/event";
import type { Editor } from "@tiptap/react";
import * as Y from "yjs";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { encodeBase64 } from "@/cloud/collaboration/base64";
import { LocalCollaborationSession } from "@/cloud/collaboration/local-session";
import { SupabaseCloudAdapter } from "@/cloud/collaboration/supabase-cloud-adapter";
import type { CloudCollaborationSession } from "@/cloud/collaboration/types";
import {
  automaticVersionDelay,
  automaticVersionMaximumDelay,
} from "@/cloud/cloud-version-history";
import { mirrorLocalPersistenceKey, openYjsPersistence } from "@/cloud/cloud-local-persistence";
import { createHeadlessMarkdownEditor } from "@/components/editor/markdown-schema";
import { serializeMarkdownDocument } from "@/components/editor/markdown-source";
import {
  MarkdownEditor,
  type MarkdownEditorPlatformActions,
} from "@/components/editor/markdown-editor";
import type { TrackedRoot } from "@/hooks/use-tracked-folders";
import {
  adoptDocument,
  defaultDocumentId,
  indexEntryToRecord,
  readGhostFolder,
  recordToIndexEntry,
  updateGhostIndexEntry,
  locateRenamedEntry,
  relocateIndexEntry,
} from "@/lib/mirror/adoption";
import { relativeToRoot } from "@/lib/mirror/ghost-index";
import { ensureCloudDocument } from "@/lib/mirror/root-sync";
import {
  IngestionQueue,
  ingestExternalChange,
  type MirrorGeneration,
} from "@/lib/mirror/ingestion-handler";
import {
  captureLocalVersion,
  listLocalVersions,
  type LocalVersionFs,
  type LocalVersionReason,
} from "@/lib/mirror/local-versions";
import { tauriMirrorFs, type FsEvent, type MirrorFs } from "@/lib/mirror/mirror-fs";
import { MirrorWriter, type MirrorWriteStatus } from "@/lib/mirror/mirror-writer";

type BootState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; session: CloudCollaborationSession };

export interface MirroredCloudContext {
  client: SupabaseClient;
  user: User;
}

const PRESENCE_COLORS = ["#ff7145", "#5ba8ff", "#76c98f", "#d68cff", "#f4bd50"];

function presenceIdentity(user: User) {
  let hash = 0;
  for (const character of user.id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return {
    name: user.user_metadata?.display_name ?? user.email?.split("@")[0] ?? "Ghost user",
    color: PRESENCE_COLORS[hash % PRESENCE_COLORS.length],
  };
}

/** How many recent mirror generations to keep for three-way merges. */
const GENERATION_LIMIT = 8;
/** How many local versions seed the generations on open. */
const SEED_VERSION_LIMIT = 4;

function rememberGeneration(generations: MirrorGeneration[], next: MirrorGeneration): void {
  const last = generations[generations.length - 1];
  if (last && last.markdown === next.markdown) return;
  generations.push(next);
  if (generations.length > GENERATION_LIMIT) generations.splice(0, generations.length - GENERATION_LIMIT);
}

function versionFsFrom(fs: MirrorFs): LocalVersionFs {
  return {
    ensureDir: (path) => fs.ensureDir(path),
    writeText: async (path, text) => {
      await fs.writeText(path, text, { expectedVersion: null, force: true });
    },
    readText: (path) => fs.readText(path),
    listFiles: (dir) => fs.listFiles(dir),
    removeFile: (path) => fs.removeGhostFile(path),
  };
}

/**
 * The editor for a Markdown file inside a mirrored root. The Yjs document is
 * canonical; this component keeps the file on disk as its mirror and ingests
 * external writes. It renders only the editor body: the layout owns the
 * header and shows the status it is told about.
 */
export function MirroredDocumentEditor({
  path,
  root,
  showStyleBar = true,
  onToggleStyleBar,
  onEditorReady,
  platformActions,
  onStatusChange,
  onNotify,
  registerFlush,
  cloud = null,
  fs = tauriMirrorFs,
}: {
  path: string;
  root: TrackedRoot;
  showStyleBar?: boolean;
  onToggleStyleBar?: () => void;
  onEditorReady?: (editor: Editor | null) => void;
  platformActions?: MarkdownEditorPlatformActions;
  onStatusChange: (status: MirrorWriteStatus, error: string | null) => void;
  onNotify: (message: string) => void;
  registerFlush: (flush: (() => Promise<void>) | null) => void;
  /** Present when signed in; used only once the root has been uploaded. */
  cloud?: MirroredCloudContext | null;
  fs?: MirrorFs;
}) {
  const [boot, setBoot] = useState<BootState>({ kind: "loading" });
  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;
  const onNotifyRef = useRef(onNotify);
  onNotifyRef.current = onNotify;
  const registerFlushRef = useRef(registerFlush);
  registerFlushRef.current = registerFlush;

  useEffect(() => {
    let active = true;
    let teardown: (() => Promise<void>) | null = null;
    setBoot({ kind: "loading" });
    onStatusChangeRef.current("saved", null);

    const start = async () => {
      const relativePath = relativeToRoot(root.path, path);
      if (relativePath === null) throw new Error("The file is outside its mirrored folder.");
      const fileName = path.slice(path.lastIndexOf("/") + 1);

      const { index } = await readGhostFolder(fs, root.path);
      let existingEntry: GhostIndexEntry | null = index.documents[relativePath] ?? null;
      if (!existingEntry) {
        // A note that was just renamed or moved keeps its document.
        const hash = await fs.hashFile(path).catch(() => null);
        const renamedFrom = hash ? await locateRenamedEntry(fs, root.path, index, relativePath, hash) : null;
        if (renamedFrom) {
          existingEntry = await relocateIndexEntry(fs, root.path, renamedFrom, relativePath, { cloudStale: true });
        }
      }
      const adopted = await adoptDocument(
        {
          fs,
          openPersistence: (rootId, documentId, document) => (
            openYjsPersistence(mirrorLocalPersistenceKey(rootId, documentId), document)
          ),
          newDocumentId: defaultDocumentId,
          now: () => new Date(),
          hydrateFromCloud: Boolean(cloud && root.cloudRootId),
        },
        root.path,
        root.id,
        relativePath,
        existingEntry,
      );
      const { documentId } = adopted;
      await updateGhostIndexEntry(fs, root.path, relativePath, adopted.entry);
      if (cloud && root.cloudRootId) {
        // A note created on this Mac joins Cloud the first time it opens.
        await ensureCloudDocument({
          fs,
          client: cloud.client,
          openPersistence: (rootId, id, doc) => openYjsPersistence(mirrorLocalPersistenceKey(rootId, id), doc),
        }, root, relativePath, documentId).catch((reason) => {
          console.warn("Could not add this note to Cloud yet:", reason);
        });
      }
      if (!active) return;

      const document = new Y.Doc();
      const persistence = await openYjsPersistence(
        mirrorLocalPersistenceKey(root.id, documentId),
        document,
      );
      const engineEditor = createHeadlessMarkdownEditor({ collaboration: document });
      // Uploaded roots edit through Cloud so the phone and collaborators see
      // changes live. If the server does not know this document yet, the
      // local session keeps working and nothing is cleared.
      let session: CloudCollaborationSession;
      if (cloud && root.cloudRootId) {
        try {
          session = await SupabaseCloudAdapter.create({
            client: cloud.client,
            document,
            documentId,
            user: presenceIdentity(cloud.user),
            onRoleVerified: async () => undefined,
            onAccessRevoked: async () => undefined,
          });
        } catch (reason) {
          console.warn("Editing locally; Cloud session unavailable:", reason);
          session = new LocalCollaborationSession(document);
        }
      } else {
        session = new LocalCollaborationSession(document);
      }
      const versionFs = versionFsFrom(fs);
      const queue = new IngestionQueue();

      // Merge bases: recent local versions, then the mirror as adopted.
      const generations: MirrorGeneration[] = [];
      const seedVersions = (await listLocalVersions(versionFs, root.path, documentId))
        .slice(0, SEED_VERSION_LIMIT)
        .reverse();
      for (const version of seedVersions) {
        const markdown = await fs.readText(version.markdownPath).catch(() => null);
        if (markdown !== null) rememberGeneration(generations, { contentHash: null, markdown });
      }
      if (adopted.entry.mirrorVersion) {
        const markdown = await fs.readText(path).catch(() => null);
        if (markdown !== null) {
          rememberGeneration(generations, { contentHash: adopted.entry.contentHash, markdown });
        }
      }

      const writer = new MirrorWriter({
        document,
        initialRecord: indexEntryToRecord(adopted.entry),
        serialize: () => serializeMarkdownDocument(engineEditor),
        write: (content, expectedVersion, force) => fs.writeText(path, content, { expectedVersion, force }),
        hash: (content) => fs.hashText(content),
        onRecord: (record) => {
          if (typeof record.content === "string") {
            rememberGeneration(generations, { contentHash: record.contentHash, markdown: record.content });
          }
          return updateGhostIndexEntry(
            fs,
            root.path,
            relativePath,
            recordToIndexEntry(documentId, record),
          );
        },
        onConflict: () => { void runIngest(); },
        onStatus: (status, error) => onStatusChangeRef.current(status, error),
      });

      const checkpoint = async (reason: LocalVersionReason) => {
        await captureLocalVersion(versionFs, root.path, documentId, {
          reason,
          markdown: serializeMarkdownDocument(engineEditor),
          yjsSnapshotBase64: encodeBase64(Y.encodeStateAsUpdate(document)),
        });
      };

      const ingest = () => ingestExternalChange({
        editor: engineEditor,
        document,
        writer,
        fileName,
        readDisk: async () => {
          try {
            const [content, version] = await Promise.all([fs.readText(path), fs.getVersion(path)]);
            return { content, version };
          } catch {
            return null;
          }
        },
        hash: (content) => fs.hashText(content),
        checkpoint,
        writeConflictCopy: (content, label) => fs.writeConflictCopy(path, content, label),
        notify: (message) => onNotifyRef.current(message),
        generations: () => generations,
        remember: (generation) => rememberGeneration(generations, generation),
      });

      // Automatic local history: idle capture, throttled and with a ceiling,
      // matching the cloud heuristic.
      let latestVersionAt: string | null = null;
      let versionTimer: ReturnType<typeof setTimeout> | null = null;
      let maximumTimer: ReturnType<typeof setTimeout> | null = null;
      let versionDirty = false;
      const clearVersionTimers = () => {
        if (versionTimer) clearTimeout(versionTimer);
        if (maximumTimer) clearTimeout(maximumTimer);
        versionTimer = null;
        maximumTimer = null;
      };
      const runVersionCapture = () => {
        clearVersionTimers();
        if (!versionDirty) return;
        versionDirty = false;
        void checkpoint("automatic").then(() => {
          latestVersionAt = new Date().toISOString();
        }).catch(() => undefined);
      };
      const scheduleVersion = () => {
        if (versionTimer) clearTimeout(versionTimer);
        versionTimer = setTimeout(runVersionCapture, automaticVersionDelay(latestVersionAt));
        if (!maximumTimer) {
          maximumTimer = setTimeout(runVersionCapture, automaticVersionMaximumDelay(latestVersionAt));
        }
      };
      const handleVersionUpdate = () => {
        versionDirty = true;
        scheduleVersion();
      };
      const existingVersions = await listLocalVersions(versionFs, root.path, documentId);
      latestVersionAt = existingVersions[0]?.createdAt ?? null;
      if (existingVersions.length === 0) {
        await checkpoint("automatic").catch(() => undefined);
        latestVersionAt = new Date().toISOString();
      }

      // Ingestion that fails leaves the writer holding its writes and says why.
      const runIngest = () => queue.run(ingest).catch((reason: unknown) => {
        const message = reason instanceof Error ? reason.message : String(reason);
        writer.reportIngestionFailure(message);
        onNotifyRef.current(`Could not merge ${fileName} from disk: ${message}`);
        return "missing" as const;
      });

      const unlisten = await listen<FsEvent>("fs-event", (event) => {
        const payload = event.payload;
        if (payload.path !== path) return;
        if (payload.kind === "modify" || payload.kind === "create" || payload.kind === "rename") {
          void runIngest();
        }
      });

      if (!active) {
        unlisten();
        await session.destroy();
        engineEditor.destroy();
        await persistence.destroy();
        document.destroy();
        return;
      }

      writer.start();
      document.on("update", handleVersionUpdate);
      // The file may have changed between adoption and the watcher attaching.
      void runIngest();
      const flush = () => writer.flush();
      registerFlushRef.current(flush);

      teardown = async () => {
        unlisten();
        document.off("update", handleVersionUpdate);
        clearVersionTimers();
        // An ingestion in flight must land in a live document, not a destroyed one.
        await queue.idle().catch(() => undefined);
        writer.stop();
        await writer.flush().catch(() => undefined);
        await session.destroy();
        engineEditor.destroy();
        await persistence.destroy();
        document.destroy();
      };

      setBoot({ kind: "ready", session });
    };

    void start().catch((reason: unknown) => {
      if (active) {
        setBoot({ kind: "error", message: reason instanceof Error ? reason.message : String(reason) });
      }
    });

    return () => {
      active = false;
      // Unregister now, before the next editor registers its own flush.
      registerFlushRef.current(null);
      void teardown?.();
      teardown = null;
    };
  }, [cloud?.client, cloud?.user.id, fs, path, root.cloudRootId, root.id, root.path]);

  // Access can change under a live session; the editor follows it.
  const session = boot.kind === "ready" ? boot.session : null;
  const role = useSyncExternalStore(
    useCallback((listener: () => void) => (session ? session.subscribe(() => listener()) : () => undefined), [session]),
    () => (session ? session.getSnapshot().role : "editor"),
  );

  if (boot.kind === "loading") {
    return <div className="h-full" aria-busy="true" />;
  }
  if (boot.kind === "error") {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <p className="text-sm text-destructive">{boot.message}</p>
      </div>
    );
  }
  return (
    <MarkdownEditor
      collaboration={{
        document: boot.session.document,
        provider: boot.session,
        user: boot.session.awareness.getLocalState()?.user ?? {},
      }}
      activeFile={path}
      editable={role !== "viewer"}
      showStyleBar={showStyleBar}
      onToggleStyleBar={onToggleStyleBar}
      onEditorReady={onEditorReady}
      platformActions={platformActions}
    />
  );
}
