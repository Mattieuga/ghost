// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import type { Editor } from "@tiptap/core";
import { createHeadlessMarkdownEditor } from "../src/components/editor/markdown-schema";
import { parseMarkdownDocument } from "../src/components/editor/frontmatter";
import {
  conflictCopyName,
  decideIngestion,
  fileVersionsEqual,
  markdownMatchesDocument,
} from "../src/lib/mirror/ingestion";
import type { FileVersionToken } from "../src/lib/source-document";

const editors: Editor[] = [];

function editorWith(markdown: string): Editor {
  const editor = createHeadlessMarkdownEditor();
  editor.commands.setContent(parseMarkdownDocument(editor, markdown), { emitUpdate: false });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  while (editors.length) editors.pop()?.destroy();
});

function token(overrides: Partial<FileVersionToken> = {}): FileVersionToken {
  return {
    canonical_path: "/notes/plan.md",
    size_bytes: 120,
    modified_ns: "1000",
    device_id: "1",
    file_id: "42",
    ...overrides,
  };
}

function stateVectors() {
  const doc = new Y.Doc();
  const text = doc.getText("t");
  text.insert(0, "hello");
  const mirrored = Y.encodeStateVector(doc);
  text.insert(5, " world");
  const changed = Y.encodeStateVector(doc);
  return { doc, mirrored, changed };
}

describe("decideIngestion", () => {
  it("ignores Ghost's own mirror write", () => {
    const { mirrored } = stateVectors();
    expect(decideIngestion({
      diskVersion: token(),
      mirrorVersion: token({ canonical_path: "/moved/plan.md" }),
      documentStateVector: mirrored,
      mirrorStateVector: mirrored,
      documentsEquivalent: false,
    })).toEqual({ kind: "ignore", reason: "own-write" });
  });

  it("replaces when the document did not move on since the last mirror", () => {
    const { mirrored } = stateVectors();
    expect(decideIngestion({
      diskVersion: token({ modified_ns: "2000", size_bytes: 140 }),
      mirrorVersion: token(),
      documentStateVector: mirrored,
      mirrorStateVector: mirrored,
      documentsEquivalent: false,
    })).toEqual({ kind: "replace" });
  });

  it("writes a conflict copy when both sides changed", () => {
    const { mirrored, changed } = stateVectors();
    expect(decideIngestion({
      diskVersion: token({ modified_ns: "2000" }),
      mirrorVersion: token(),
      documentStateVector: changed,
      mirrorStateVector: mirrored,
      documentsEquivalent: false,
    })).toEqual({ kind: "conflict" });
  });

  it("records the disk copy as current when only formatting differs", () => {
    const { mirrored, changed } = stateVectors();
    expect(decideIngestion({
      diskVersion: token({ modified_ns: "2000" }),
      mirrorVersion: token(),
      documentStateVector: changed,
      mirrorStateVector: mirrored,
      documentsEquivalent: true,
    })).toEqual({ kind: "record-disk" });
  });

  it("refuses to guess without a recorded state vector", () => {
    const { changed } = stateVectors();
    expect(decideIngestion({
      diskVersion: token({ modified_ns: "2000" }),
      mirrorVersion: null,
      documentStateVector: changed,
      mirrorStateVector: null,
      documentsEquivalent: false,
    })).toEqual({ kind: "conflict" });
  });
});

describe("fileVersionsEqual", () => {
  it("ignores the path so a moved file with the same bytes still matches", () => {
    expect(fileVersionsEqual(token(), token({ canonical_path: "/elsewhere/plan.md" }))).toBe(true);
    expect(fileVersionsEqual(token(), token({ size_bytes: 121 }))).toBe(false);
  });
});

describe("markdownMatchesDocument", () => {
  it("treats formatting-only differences as the same document", () => {
    const editor = editorWith("# Plan\n\n- one\n- two\n");
    expect(markdownMatchesDocument(editor, "# Plan\n\n* one\n* two\n")).toBe(true);
    expect(markdownMatchesDocument(editor, "Plan\n====\n\n*   one\n*   two")).toBe(true);
  });

  it("notices a real content change", () => {
    const editor = editorWith("# Plan\n\n- one\n- two\n");
    expect(markdownMatchesDocument(editor, "# Plan\n\n- one\n- three\n")).toBe(false);
  });
});

describe("conflictCopyName", () => {
  it("keeps the extension and stamps local date and time", () => {
    const when = new Date(2026, 8, 2, 14, 3);
    expect(conflictCopyName("plan.md", when)).toBe("plan (conflict 2026-09-02 14.03).md");
    expect(conflictCopyName("README", when)).toBe("README (conflict 2026-09-02 14.03)");
  });
});
