import { invoke } from "@tauri-apps/api/core";
import {
  classifyFile,
  resolveProbedText,
  type FileDescriptor,
} from "@/lib/file-type";
import type { FileVersionToken } from "@/lib/source-document";
import { Text } from "@codemirror/state";
import {
  resolveSourceProfile,
  type SourceInspection,
  type SourceProfile,
} from "@/lib/resource-policy";
import {
  createFileOpenPerformanceTrace,
  performanceNow,
  type FileOpenPerformanceTrace,
} from "@/lib/open-performance";

interface SourceChunkResult {
  text: string;
  next_offset: number;
  eof: boolean;
  diagnostics?: {
    elapsed_us: number;
    bytes_read: number;
  };
  transport?: "json" | "raw";
  frontend_decode_ms?: number;
}

export interface FileModel {
  path: string;
  descriptor: FileDescriptor;
  content: string;
  version: FileVersionToken | null;
  sourceDocument: Text | null;
  sourceProfile: SourceProfile | null;
  sourceInspection: SourceInspection | null;
  lineSeparator: string;
  openPerformance: FileOpenPerformanceTrace | null;
}

export interface FileLoaderBackend {
  readText(path: string): Promise<string>;
  probeText(path: string): Promise<string | null>;
  getVersion?(path: string): Promise<FileVersionToken>;
  inspectSource?(path: string, probeText: boolean): Promise<SourceInspection>;
  readSourceChunk?(
    path: string,
    offset: number,
    expectedVersion: FileVersionToken,
  ): Promise<SourceChunkResult>;
}

const sourceDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

const tauriFileLoaderBackend: FileLoaderBackend = {
  readText: (path) => invoke<string>("read_file", { path }),
  probeText: (path) => invoke<string | null>("read_file_if_text", { path }),
  getVersion: (path) => invoke<FileVersionToken>("get_file_version", { path }),
  inspectSource: (path, probeText) => invoke<SourceInspection>("inspect_source", {
    path,
    probeText,
  }),
  readSourceChunk: async (path, offset, expectedVersion) => {
    const buffer = await invoke<ArrayBuffer>("read_source_chunk_raw", {
      path,
      offset,
      maxBytes: 2 * 1024 * 1024,
      expectedVersion,
    });
    const bytes = new Uint8Array(buffer);
    const decodeStarted = performanceNow();
    const text = sourceDecoder.decode(bytes);
    const frontendDecodeMs = performanceNow() - decodeStarted;
    const nextOffset = offset + bytes.byteLength;
    return {
      text,
      next_offset: nextOffset,
      eof: nextOffset >= expectedVersion.size_bytes,
      transport: "raw",
      frontend_decode_ms: frontendDecodeMs,
    };
  },
};

function assertNever(mode: never): never {
  throw new Error(`Unhandled file load mode: ${mode}`);
}

function versionsEqual(left: FileVersionToken, right: FileVersionToken): boolean {
  return left.canonical_path === right.canonical_path
    && left.size_bytes === right.size_bytes
    && left.modified_ns === right.modified_ns
    && left.device_id === right.device_id
    && left.file_id === right.file_id;
}

/**
 * Apply one loading policy for every window. Binary viewers own their resource;
 * text documents receive content, and unknown files are promoted only after a
 * successful backend text probe.
 */
export async function loadFileModel(
  path: string,
  backend: FileLoaderBackend = tauriFileLoaderBackend,
  signal?: AbortSignal,
): Promise<FileModel> {
  const openPerformanceCandidate = createFileOpenPerformanceTrace(path);
  const assertActive = () => {
    if (signal?.aborted) throw new DOMException("File load cancelled", "AbortError");
  };
  assertActive();
  const classifyStarted = performanceNow();
  const descriptor = classifyFile(path);
  const loadMode = descriptor.loadMode;
  const isSourceCandidate = loadMode === "text" || loadMode === "probe-text";
  const openPerformance = isSourceCandidate ? openPerformanceCandidate : null;
  openPerformance?.record("Classify file", performanceNow() - classifyStarted);

  const complete = (model: Omit<FileModel, "openPerformance">): FileModel => {
    openPerformance?.markModelReady();
    return { ...model, openPerformance };
  };

  if (isSourceCandidate && backend.inspectSource && backend.readSourceChunk) {
    const inspectionStarted = performanceNow();
    const inspection = await backend.inspectSource(path, loadMode === "probe-text");
    const inspectionRoundTripMs = performanceNow() - inspectionStarted;
    const inspectionNativeMs = (inspection.diagnostics?.elapsed_us ?? 0) / 1000;
    if (inspection.diagnostics) {
      openPerformance?.record(
        "Native source inspection",
        inspectionNativeMs,
        `${inspection.diagnostics.bytes_read.toLocaleString()} bytes scanned`,
      );
      openPerformance?.record(
        "Inspection bridge + scheduling",
        inspectionRoundTripMs - inspectionNativeMs,
        "round trip minus native command time",
      );
    } else {
      openPerformance?.record("Source inspection round trip", inspectionRoundTripMs);
    }
    assertActive();
    if (loadMode === "probe-text" && !inspection.looks_textual) {
      return complete({
        path,
        descriptor,
        content: "",
        version: inspection.version,
        sourceDocument: null,
        sourceProfile: null,
        sourceInspection: inspection,
        lineSeparator: inspection.line_separator,
      });
    }

    const resolvedDescriptor = loadMode === "probe-text" ? resolveProbedText(descriptor) : descriptor;
    const sourceProfile = resolveSourceProfile(resolvedDescriptor, inspection);
    openPerformance?.setSourceMetadata(sourceProfile, inspection.size_bytes, inspection.line_count);
    if (sourceProfile === "extreme") {
      return complete({
        path,
        descriptor: {
          ...resolvedDescriptor,
          editable: false,
          searchable: false,
          showTextStats: false,
        },
        content: "",
        version: inspection.version,
        sourceDocument: null,
        sourceProfile,
        sourceInspection: inspection,
        lineSeparator: inspection.line_separator,
      });
    }

    if (sourceProfile === "large") {
      let document = Text.empty;
      let offset = 0;
      let chunkCount = 0;
      let chunkBytes = 0;
      let chunkRoundTripMs = 0;
      let chunkNativeMs = 0;
      let normalizeMs = 0;
      let splitMs = 0;
      let textConstructionMs = 0;
      let appendMs = 0;
      let frontendDecodeMs = 0;
      let chunksWithNativeTiming = 0;
      let rawChunks = 0;
      while (offset < inspection.size_bytes) {
        assertActive();
        const chunkStarted = performanceNow();
        const chunk = await backend.readSourceChunk(path, offset, inspection.version);
        chunkRoundTripMs += performanceNow() - chunkStarted;
        if (chunk.diagnostics) {
          chunkNativeMs += chunk.diagnostics.elapsed_us / 1000;
          chunkBytes += chunk.diagnostics.bytes_read;
          chunksWithNativeTiming += 1;
        } else {
          chunkBytes += Math.max(0, chunk.next_offset - offset);
        }
        chunkCount += 1;
        frontendDecodeMs += chunk.frontend_decode_ms ?? 0;
        if (chunk.transport === "raw") rawChunks += 1;
        assertActive();
        if (chunk.next_offset <= offset && !chunk.eof) {
          throw new Error("The source reader did not make progress");
        }
        let stageStarted = performanceNow();
        const normalized = chunk.text.replace(/\r\n|\r/g, "\n");
        normalizeMs += performanceNow() - stageStarted;
        stageStarted = performanceNow();
        const lines = normalized.split("\n");
        splitMs += performanceNow() - stageStarted;
        stageStarted = performanceNow();
        const chunkDocument = Text.of(lines);
        textConstructionMs += performanceNow() - stageStarted;
        stageStarted = performanceNow();
        document = document.append(chunkDocument);
        appendMs += performanceNow() - stageStarted;
        offset = chunk.next_offset;
        if (chunk.eof) break;
      }
      const chunkDetail = `${chunkCount} chunks · ${chunkBytes.toLocaleString()} bytes`;
      if (rawChunks === chunkCount && chunkCount > 0) {
        openPerformance?.record(
          "Raw chunk transport",
          chunkRoundTripMs - frontendDecodeMs,
          chunkDetail,
        );
        openPerformance?.record("Decode raw UTF-8 chunks", frontendDecodeMs);
      } else if (chunksWithNativeTiming === chunkCount && chunkCount > 0) {
        openPerformance?.record("Native source chunk reads", chunkNativeMs, chunkDetail);
        openPerformance?.record(
          "Chunk bridge + serialization",
          chunkRoundTripMs - chunkNativeMs,
          "round trips minus native command time",
        );
      } else {
        openPerformance?.record("Source chunk round trips", chunkRoundTripMs, chunkDetail);
      }
      openPerformance?.record("Normalize line endings", normalizeMs);
      openPerformance?.record("Split chunks into lines", splitMs);
      openPerformance?.record("Build CodeMirror text chunks", textConstructionMs);
      openPerformance?.record("Append CodeMirror text tree", appendMs);
      openPerformance?.setChunkMetadata(chunkCount, chunkBytes);
      if (backend.getVersion) {
        const versionCheckStarted = performanceNow();
        const finalVersion = await backend.getVersion(path);
        openPerformance?.record("Final version check", performanceNow() - versionCheckStarted);
        assertActive();
        if (!versionsEqual(finalVersion, inspection.version)) {
          throw new Error("The file changed on disk while Ghost was loading it");
        }
      }

      return complete({
        path,
        descriptor: resolvedDescriptor,
        content: "",
        version: inspection.version,
        sourceDocument: document,
        sourceProfile,
        sourceInspection: inspection,
        lineSeparator: inspection.line_separator,
      });
    }

    const fullReadStarted = performanceNow();
    const content = await backend.readText(path);
    openPerformance?.record("Complete text read round trip", performanceNow() - fullReadStarted);
    assertActive();
    if (backend.getVersion) {
      const versionCheckStarted = performanceNow();
      const finalVersion = await backend.getVersion(path);
      openPerformance?.record("Final version check", performanceNow() - versionCheckStarted);
      assertActive();
      if (!versionsEqual(finalVersion, inspection.version)) {
        throw new Error("The file changed on disk while Ghost was loading it");
      }
    }
    return complete({
      path,
      descriptor: resolvedDescriptor,
      content,
      version: inspection.version,
      sourceDocument: null,
      sourceProfile,
      sourceInspection: inspection,
      lineSeparator: inspection.line_separator,
    });
  }

  const version = backend.getVersion ? await backend.getVersion(path) : null;
  assertActive();
  const base = {
    sourceDocument: null,
    sourceProfile: null,
    sourceInspection: null,
    lineSeparator: "\n",
  } as const;

  switch (loadMode) {
    case "text":
      {
        const content = await backend.readText(path);
        assertActive();
        return complete({ path, descriptor, content, version, ...base });
      }
    case "probe-text": {
      const content = await backend.probeText(path);
      assertActive();
      return content === null
        ? complete({ path, descriptor, content: "", version, ...base })
        : complete({ path, descriptor: resolveProbedText(descriptor), content, version, ...base });
    }
    case "viewer-owned":
    case "asset-url":
      return complete({ path, descriptor, content: "", version, ...base });
    default:
      return assertNever(loadMode);
  }
}
