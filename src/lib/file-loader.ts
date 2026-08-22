import { invoke } from "@tauri-apps/api/core";
import {
  classifyFile,
  resolveProbedText,
  type FileDescriptor,
} from "@/lib/file-type";

export interface FileModel {
  path: string;
  descriptor: FileDescriptor;
  content: string;
}

export interface FileLoaderBackend {
  readText(path: string): Promise<string>;
  probeText(path: string): Promise<string | null>;
}

const tauriFileLoaderBackend: FileLoaderBackend = {
  readText: (path) => invoke<string>("read_file", { path }),
  probeText: (path) => invoke<string | null>("read_file_if_text", { path }),
};

function assertNever(mode: never): never {
  throw new Error(`Unhandled file load mode: ${mode}`);
}

/**
 * Apply one loading policy for every window. Binary viewers own their resource;
 * text documents receive content, and unknown files are promoted only after a
 * successful backend text probe.
 */
export async function loadFileModel(
  path: string,
  backend: FileLoaderBackend = tauriFileLoaderBackend,
): Promise<FileModel> {
  const descriptor = classifyFile(path);
  const loadMode = descriptor.loadMode;

  switch (loadMode) {
    case "text":
      return { path, descriptor, content: await backend.readText(path) };
    case "probe-text": {
      const content = await backend.probeText(path);
      return content === null
        ? { path, descriptor, content: "" }
        : { path, descriptor: resolveProbedText(descriptor), content };
    }
    case "viewer-owned":
    case "asset-url":
      return { path, descriptor, content: "" };
    default:
      return assertNever(loadMode);
  }
}
