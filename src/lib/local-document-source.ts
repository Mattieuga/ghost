import { invoke } from "@tauri-apps/api/core";
import { loadFileModel, type FileModel } from "@/lib/file-loader";
import {
  LOCAL_DOCUMENT_CAPABILITIES,
  type LocalDocumentRef,
} from "@/lib/document-ref";
import type { FileVersionToken } from "@/lib/source-document";

export interface LocalTextWrite {
  content: string;
  expectedContent: string | null;
  expectedVersion: FileVersionToken | null;
  force: boolean;
}

export interface LocalSourceWrite {
  expectedVersion: FileVersionToken | null;
  force: boolean;
}

export interface LocalSourceSaveSession {
  sessionId: number;
}

/**
 * The only production gateway from a LocalDocumentRef to Tauri filesystem
 * commands. Cloud implementations intentionally cannot satisfy this contract.
 */
export interface LocalDocumentSource {
  readonly kind: "local";
  readonly capabilities: typeof LOCAL_DOCUMENT_CAPABILITIES;
  load(ref: LocalDocumentRef, signal?: AbortSignal): Promise<FileModel>;
  readText(ref: LocalDocumentRef): Promise<string>;
  getVersion(ref: LocalDocumentRef): Promise<FileVersionToken>;
  writeText(ref: LocalDocumentRef, write: LocalTextWrite): Promise<FileVersionToken>;
  beginSourceWrite(
    ref: LocalDocumentRef,
    write: LocalSourceWrite,
  ): Promise<LocalSourceSaveSession>;
  appendSourceWrite(session: LocalSourceSaveSession, chunk: string): Promise<void>;
  commitSourceWrite(session: LocalSourceSaveSession): Promise<FileVersionToken>;
  abortSourceWrite(session: LocalSourceSaveSession): Promise<void>;
}

export const tauriLocalDocumentSource: LocalDocumentSource = {
  kind: "local",
  capabilities: LOCAL_DOCUMENT_CAPABILITIES,
  load: (ref, signal) => loadFileModel(ref.path, undefined, signal),
  readText: (ref) => invoke<string>("read_file", { path: ref.path }),
  getVersion: (ref) => invoke<FileVersionToken>("get_file_version", { path: ref.path }),
  writeText: (ref, write) => invoke<FileVersionToken>("write_file", {
    path: ref.path,
    content: write.content,
    expectedContent: write.expectedContent,
    expectedVersion: write.expectedVersion,
    force: write.force,
  }),
  beginSourceWrite: async (ref, write) => {
    const handle = await invoke<{ session_id: number }>("begin_source_save", {
      path: ref.path,
      expectedVersion: write.expectedVersion,
      force: write.force,
    });
    return { sessionId: handle.session_id };
  },
  appendSourceWrite: (session, chunk) => invoke("append_source_save", {
    sessionId: session.sessionId,
    chunk,
  }),
  commitSourceWrite: (session) => invoke<FileVersionToken>("commit_source_save", {
    sessionId: session.sessionId,
  }),
  abortSourceWrite: (session) => invoke("abort_source_save", {
    sessionId: session.sessionId,
  }),
};
