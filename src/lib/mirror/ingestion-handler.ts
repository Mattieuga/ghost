import type { Editor, JSONContent } from "@tiptap/core";
import * as Y from "yjs";
import { parseMarkdownDocument } from "@/components/editor/frontmatter";
import { applyDocumentAsBlockDiff } from "@/lib/mirror/block-diff";
import {
  conflictCopyName,
  decideIngestion,
  markdownMatchesDocument,
} from "@/lib/mirror/ingestion";
import type { MirrorWriter } from "@/lib/mirror/mirror-writer";
import { chooseMergeBase, mergeBlocks } from "@/lib/mirror/three-way-merge";
import type { FileVersionToken } from "@/lib/source-document";

export interface DiskSnapshot {
  content: string;
  version: FileVersionToken;
}

/** Markdown Ghost wrote to, or accepted from, the mirror file. Oldest first. */
export interface MirrorGeneration {
  contentHash: string | null;
  markdown: string;
}

export interface IngestionContext {
  /** The editor bound to the document, visible or headless. */
  editor: Editor;
  document: Y.Doc;
  writer: MirrorWriter;
  fileName: string;
  readDisk(): Promise<DiskSnapshot | null>;
  hash(content: string): Promise<string>;
  /** Take a version before the document changes so nothing is lost. */
  checkpoint(reason: "external_write"): Promise<void>;
  /** Write `content` beside the file and return the new path. */
  writeConflictCopy(content: string, label: string): Promise<string>;
  notify(message: string): void;
  /** Recent mirror generations, used to find what an external write was based on. */
  generations(): MirrorGeneration[];
  /** Record disk content Ghost accepted as current. */
  remember(generation: MirrorGeneration): void;
}

export type IngestionOutcome = "ignore" | "record-disk" | "replace" | "merge" | "conflict" | "missing";

const parsedBlocks = new Map<string, JSONContent[]>();
const PARSED_CACHE_LIMIT = 32;

function blocksOf(editor: Editor, markdown: string): JSONContent[] {
  const cached = parsedBlocks.get(markdown);
  if (cached) return cached;
  const blocks = parseMarkdownDocument(editor, markdown).content ?? [];
  if (parsedBlocks.size >= PARSED_CACHE_LIMIT) {
    const oldest = parsedBlocks.keys().next().value;
    if (oldest !== undefined) parsedBlocks.delete(oldest);
  }
  parsedBlocks.set(markdown, blocks);
  return blocks;
}

function sameBlocks(left: JSONContent[], right: JSONContent[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function applyReplacement(
  context: IngestionContext,
  blocks: JSONContent[],
): Promise<void> {
  await context.checkpoint("external_write");
  const content = blocks.length > 0 ? blocks : [{ type: "paragraph" }];
  context.writer.runSuspended(() => {
    applyDocumentAsBlockDiff(context.editor, { type: "doc", content }, { addToHistory: false });
  });
}

async function acceptDisk(context: IngestionContext, disk: DiskSnapshot): Promise<void> {
  const contentHash = await context.hash(disk.content);
  context.writer.markDiskCurrent(disk.version, contentHash, disk.content);
  context.remember({ contentHash, markdown: disk.content });
}

async function keepOursAndCopyTheirs(
  context: IngestionContext,
  disk: DiskSnapshot,
): Promise<"conflict"> {
  const label = conflictCopyName("x", new Date()).slice("x (conflict ".length, -1);
  const copyPath = await context.writeConflictCopy(disk.content, label);
  await context.writer.forceWrite();
  const copyName = copyPath.slice(copyPath.lastIndexOf("/") + 1);
  context.notify(
    `Kept your version of ${context.fileName}. The other version was saved as ${copyName}.`,
  );
  return "conflict";
}

/**
 * Apply the external-write policy to one document once.
 *
 * Own writes and formatting-only changes are settled by `decideIngestion`.
 * Everything else is a three-way merge: the external content is compared
 * against recent mirror generations to find the one it was based on, then
 * merged block by block with the current document. Non-overlapping changes
 * merge, a stale copy gets our edits restored, and overlaps keep our version
 * on disk with theirs saved beside it. With no generation to merge against,
 * the state-vector rules decide between replace and conflict.
 */
export async function ingestExternalChange(context: IngestionContext): Promise<IngestionOutcome> {
  const disk = await context.readDisk();
  if (!disk) return "missing";

  const verdict = decideIngestion({
    diskVersion: disk.version,
    mirrorVersion: context.writer.record.version,
    documentStateVector: Y.encodeStateVector(context.document),
    mirrorStateVector: context.writer.record.stateVector,
    documentsEquivalent: markdownMatchesDocument(context.editor, disk.content),
  });
  if (verdict.kind === "ignore") return "ignore";
  if (verdict.kind === "record-disk") {
    await acceptDisk(context, disk);
    return "record-disk";
  }

  const theirs = blocksOf(context.editor, disk.content);
  const ours = context.editor.getJSON().content ?? [];
  const candidates = context.generations().map((generation) => ({
    generation,
    blocks: blocksOf(context.editor, generation.markdown),
  }));
  const base = chooseMergeBase(candidates, theirs);

  if (!base) {
    if (verdict.kind === "replace") {
      await applyReplacement(context, theirs);
      await acceptDisk(context, disk);
      return "replace";
    }
    return keepOursAndCopyTheirs(context, disk);
  }

  const merge = mergeBlocks(base.blocks, ours, theirs);
  if (merge.kind === "conflict") return keepOursAndCopyTheirs(context, disk);

  if (merge.changedFromOurs) await applyReplacement(context, merge.merged);
  if (merge.changedFromTheirs) {
    // The file lacks something the document has, so the document wins the
    // disk. The writer records the new generation.
    await context.writer.forceWrite();
  } else {
    await acceptDisk(context, disk);
  }
  return sameBlocks(base.blocks, ours) ? "replace" : "merge";
}

/**
 * Serialize ingestion runs for one document so overlapping watcher events
 * cannot interleave a replace with a conflict copy.
 */
export class IngestionQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run(task: () => Promise<IngestionOutcome>): Promise<IngestionOutcome> {
    const next = this.tail.then(task, task);
    this.tail = next.catch(() => undefined);
    return next;
  }

  /** Resolves once every queued run has settled. */
  idle(): Promise<void> {
    return this.tail.then(() => undefined);
  }
}
