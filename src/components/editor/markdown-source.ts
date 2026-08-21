import type { Editor, JSONContent } from "@tiptap/core";
import { parseMarkdownDocument } from "./frontmatter";

interface MarkdownDocumentState {
  dirty: boolean;
  revision: number;
  pendingMarkdown: string | null;
}

interface MarkdownManagerInternals {
  serialize: (document: JSONContent) => string;
  encodeTextForMarkdown: (
    text: string,
    node: JSONContent,
    parentNode?: JSONContent,
  ) => string;
}

interface TextReplacement {
  marker: string;
  leadingWhitespace: string;
  trailingWhitespace: string;
  characters: Array<{
    raw: string;
    safe: string;
    candidateId: number | null;
  }>;
}

const documentStates = new WeakMap<Editor, MarkdownDocumentState>();
const MAX_PARSE_VALIDATIONS = 64;

function getDocumentState(editor: Editor): MarkdownDocumentState {
  let state = documentStates.get(editor);
  if (!state) {
    state = { dirty: false, revision: 0, pendingMarkdown: null };
    documentStates.set(editor, state);
  }
  return state;
}

export function markMarkdownDocumentDirty(editor: Editor, markdown: string): number {
  const state = getDocumentState(editor);
  state.dirty = true;
  state.revision += 1;
  state.pendingMarkdown = markdown;
  return state.revision;
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

function safeMarkdownCharacter(character: string): string {
  const htmlEncoded = character === "&"
    ? "&amp;"
    : character === "<"
      ? "&lt;"
      : character === ">"
        ? "&gt;"
        : character;

  return /[\\`*_[\]~]/.test(htmlEncoded) ? `\\${htmlEncoded}` : htmlEncoded;
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
  if (typeof manager.encodeTextForMarkdown !== "function") return safeOutput;

  const targetDocument = JSON.stringify(document);
  if (!documentsMatch(editor, safeOutput, targetDocument)) return safeOutput;

  const replacements: TextReplacement[] = [];
  let candidateCount = 0;
  let markerPrefix = "\uE100GHOSTSOURCETEXT";
  while (safeOutput.includes(markerPrefix)) markerPrefix += "X";

  const originalEncoder = manager.encodeTextForMarkdown;
  let skeleton: string;

  manager.encodeTextForMarkdown = (text, node, parentNode) => {
    const safeText = originalEncoder.call(manager, text, node, parentNode);
    if (safeText === text) return safeText;

    const leadingWhitespace = text.match(/^\s+/)?.[0] ?? "";
    const withoutLeading = text.slice(leadingWhitespace.length);
    const trailingWhitespace = withoutLeading.match(/\s+$/)?.[0] ?? "";
    const core = withoutLeading.slice(0, withoutLeading.length - trailingWhitespace.length);
    const marker = `${markerPrefix}${replacements.length}\uE101`;
    const characters = Array.from(core, (raw) => {
      const safe = safeMarkdownCharacter(raw);
      return {
        raw,
        safe,
        candidateId: safe === raw ? null : candidateCount++,
      };
    });

    replacements.push({ marker, leadingWhitespace, trailingWhitespace, characters });
    return `${leadingWhitespace}${marker}${trailingWhitespace}`;
  };

  try {
    skeleton = manager.serialize(document);
  } finally {
    manager.encodeTextForMarkdown = originalEncoder;
  }

  const rawCandidates = new Set<number>();
  const render = () => replacements.reduce((markdown, replacement) => {
    const text = replacement.characters.map(({ raw, safe, candidateId }) =>
      candidateId !== null && rawCandidates.has(candidateId) ? raw : safe
    ).join("");
    return markdown.replace(replacement.marker, text);
  }, skeleton);

  // Guard against upstream serializer changes before relying on its private
  // text-encoding seam. A mismatch simply keeps Tiptap's original output.
  if (render() !== safeOutput || candidateCount === 0) return safeOutput;

  let validationCount = 0;
  const acceptRawBatch = (candidateIds: number[]): void => {
    if (candidateIds.length === 0 || validationCount >= MAX_PARSE_VALIDATIONS) return;

    candidateIds.forEach((id) => rawCandidates.add(id));
    validationCount += 1;
    if (documentsMatch(editor, render(), targetDocument)) return;
    candidateIds.forEach((id) => rawCandidates.delete(id));

    if (candidateIds.length === 1) return;
    const midpoint = Math.floor(candidateIds.length / 2);
    acceptRawBatch(candidateIds.slice(0, midpoint));
    acceptRawBatch(candidateIds.slice(midpoint));
  };

  acceptRawBatch(Array.from({ length: candidateCount }, (_, index) => index));
  return render();
}

export function serializeMarkdownDocument(editor: Editor): string {
  return serializeMarkdownContent(editor, editor.getJSON());
}
