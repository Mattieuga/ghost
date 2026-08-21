import type { Editor, JSONContent } from "@tiptap/core";
import { parseMarkdownDocument } from "./frontmatter";

interface MarkdownDocumentState {
  dirty: boolean;
  revision: number;
  pendingMarkdown: string | null;
}

interface MarkdownManagerInternals {
  serialize: (document: JSONContent) => string;
}

interface EscapeCandidate {
  safe: string;
  raw: string;
}

const documentStates = new WeakMap<Editor, MarkdownDocumentState>();

function getDocumentState(editor: Editor): MarkdownDocumentState {
  let state = documentStates.get(editor);
  if (!state) {
    state = { dirty: false, revision: 0, pendingMarkdown: null };
    documentStates.set(editor, state);
  }
  return state;
}

export function markMarkdownDocumentDirty(editor: Editor, markdown: string | null = null): number {
  const state = getDocumentState(editor);
  state.dirty = true;
  state.revision += 1;
  state.pendingMarkdown = markdown;
  return state.revision;
}

export function cachePendingMarkdownDocument(
  editor: Editor,
  revision: number,
  markdown: string,
): void {
  const state = getDocumentState(editor);
  if (state.revision === revision && state.dirty) state.pendingMarkdown = markdown;
}

export function markMarkdownDocumentClean(editor: Editor, revision?: number): void {
  const state = getDocumentState(editor);
  if (revision !== undefined && state.revision !== revision) return;
  state.dirty = false;
  state.pendingMarkdown = null;
}

export function resetMarkdownDocumentState(editor: Editor): void {
  const state = getDocumentState(editor);
  state.dirty = false;
  state.revision += 1;
  state.pendingMarkdown = null;
}

export function isMarkdownDocumentDirty(editor: Editor): boolean {
  return getDocumentState(editor).dirty;
}

export function getPendingMarkdownDocument(editor: Editor): {
  markdown: string | null;
  revision: number;
} {
  const state = getDocumentState(editor);
  return { markdown: state.pendingMarkdown, revision: state.revision };
}

function documentsMatch(editor: Editor, markdown: string, target: string): boolean {
  try {
    const parsed = parseMarkdownDocument(editor, markdown);
    const normalized = editor.schema.nodeFromJSON(parsed).toJSON();
    return JSON.stringify(normalized) === target;
  } catch {
    return false;
  }
}

function collectEscapeCandidates(markdown: string): {
  candidates: EscapeCandidate[];
  render: (rawCandidates: Set<number>) => string;
} {
  const candidates: EscapeCandidate[] = [];
  const pieces: Array<string | number> = [];
  const pattern = /&(?:amp|lt|gt);|\\[\\`*_[\]~]/g;
  let cursor = 0;

  for (const match of markdown.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) pieces.push(markdown.slice(cursor, index));

    const safe = match[0];
    const raw = safe === "&amp;"
      ? "&"
      : safe === "&lt;"
        ? "<"
        : safe === "&gt;"
          ? ">"
          : safe.slice(1);
    const candidateId = candidates.length;
    candidates.push({ safe, raw });
    pieces.push(candidateId);
    cursor = index + safe.length;
  }

  if (cursor < markdown.length) pieces.push(markdown.slice(cursor));

  return {
    candidates,
    render: (rawCandidates) => pieces.map((piece) => {
      if (typeof piece === "string") return piece;
      const candidate = candidates[piece];
      return rawCandidates.has(piece) ? candidate.raw : candidate.safe;
    }).join(""),
  };
}

/**
 * Relax Tiptap's conservative escaping while using the parsed editor document
 * as the correctness oracle. Work is intentionally scoped to one top-level
 * block in the common path so a long document never needs dozens of complete
 * reparses just because one paragraph contains literal Markdown punctuation.
 */
function relaxMarkdownOutput(editor: Editor, safeOutput: string, target: string): string {
  if (!documentsMatch(editor, safeOutput, target)) return safeOutput;

  const { candidates, render } = collectEscapeCandidates(safeOutput);
  if (candidates.length === 0) return safeOutput;

  const rawCandidates = new Set<number>();
  const acceptRawBatch = (candidateIds: number[]): void => {
    if (candidateIds.length === 0) return;

    candidateIds.forEach((id) => rawCandidates.add(id));
    if (documentsMatch(editor, render(rawCandidates), target)) return;
    candidateIds.forEach((id) => rawCandidates.delete(id));

    if (candidateIds.length === 1) return;
    const midpoint = Math.floor(candidateIds.length / 2);
    acceptRawBatch(candidateIds.slice(0, midpoint));
    acceptRawBatch(candidateIds.slice(midpoint));
  };

  acceptRawBatch(candidates.map((_, index) => index));
  return render(rawCandidates);
}

/**
 * Serialize through Tiptap, then relax only entity/backslash escapes whose
 * removal still parses to the exact same editor document. Tiptap's safe
 * output remains the fallback for genuine Markdown delimiters.
 */
export function serializeMarkdownContent(
  editor: Editor,
  document: JSONContent = editor.getJSON(),
): string {
  const manager = editor.markdown as unknown as MarkdownManagerInternals | undefined;
  if (!manager || typeof manager.serialize !== "function") {
    throw new Error("Markdown serializer unavailable");
  }

  const safeOutput = manager.serialize(document);
  const targetDocument = JSON.stringify(document);
  if (!documentsMatch(editor, safeOutput, targetDocument)) return safeOutput;

  const blocks = document.type === "doc" ? document.content ?? [] : [];
  if (blocks.length <= 1) return relaxMarkdownOutput(editor, safeOutput, targetDocument);

  const relaxedBlocks = blocks.map((block) => {
    const blockDocument: JSONContent = { type: "doc", content: [block] };
    const safeBlock = manager.serialize(blockDocument);
    return relaxMarkdownOutput(editor, safeBlock, JSON.stringify(blockDocument));
  });
  const blockOutput = relaxedBlocks.join("\n\n");

  // Tiptap's document renderer normally separates top-level blocks with one
  // blank line. Validate the assembled result because adjacent lists and
  // extension-defined nodes can occasionally require document-level context.
  if (documentsMatch(editor, blockOutput, targetDocument)) return blockOutput;

  // Unusual cross-block structures retain correctness. This slower fallback
  // runs only during a debounced/explicit save, never in the typing handler.
  return relaxMarkdownOutput(editor, safeOutput, targetDocument);
}

export function serializeMarkdownDocument(editor: Editor): string {
  return serializeMarkdownContent(editor, editor.getJSON());
}
