// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import type { Editor } from "@tiptap/core";
import { createHeadlessMarkdownEditor } from "../src/components/editor/markdown-schema";
import { parseMarkdownDocument } from "../src/components/editor/frontmatter";
import { serializeMarkdownDocument } from "../src/components/editor/markdown-source";
import { MirrorWriter, type MirrorRecord } from "../src/lib/mirror/mirror-writer";
import {
  ingestExternalChange,
  IngestionQueue,
  type DiskSnapshot,
  type MirrorGeneration,
} from "../src/lib/mirror/ingestion-handler";
import type { FileVersionToken } from "../src/lib/source-document";

const editors: Editor[] = [];
const writers: MirrorWriter[] = [];

afterEach(() => {
  while (writers.length) writers.pop()?.stop();
  while (editors.length) editors.pop()?.destroy();
});

function token(modified: number, size = 100): FileVersionToken {
  return {
    canonical_path: "/notes/plan.md",
    size_bytes: size,
    modified_ns: String(modified),
    device_id: "1",
    file_id: "9",
  };
}

async function hash(text: string): Promise<string> {
  let value = 0;
  for (const character of text) value = (value * 31 + character.charCodeAt(0)) >>> 0;
  return `h${value}`;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A document bound to a Yjs doc, seeded from Markdown, with a mirror writer over a fake disk. */
async function mirroredDocument(markdown: string, options: { debounceMs?: number } = {}) {
  const doc = new Y.Doc();
  const editor = createHeadlessMarkdownEditor({ collaboration: doc });
  editors.push(editor);
  editor.commands.setContent(parseMarkdownDocument(editor, markdown), { emitUpdate: false });

  const disk = { content: markdown, version: token(1) };
  const writes: Array<{ content: string; expectedVersion: FileVersionToken | null; force: boolean }> = [];
  const records: MirrorRecord[] = [];
  const statuses: string[] = [];
  const conflicts = vi.fn();
  let nextModified = 2;

  const generations: MirrorGeneration[] = [{ contentHash: await hash(markdown), markdown }];
  const remember = (generation: MirrorGeneration) => {
    if (generations[generations.length - 1]?.markdown !== generation.markdown) generations.push(generation);
  };
  const writer = new MirrorWriter({
    document: doc,
    initialRecord: {
      version: disk.version,
      stateVector: Y.encodeStateVector(doc),
      contentHash: await hash(markdown),
    },
    serialize: () => serializeMarkdownDocument(editor),
    write: async (content, expectedVersion, force) => {
      writes.push({ content, expectedVersion, force });
      if (!force && expectedVersion && expectedVersion.modified_ns !== disk.version.modified_ns) {
        throw { kind: "conflict", message: "The file changed on disk" };
      }
      disk.content = content;
      disk.version = token(nextModified++, content.length);
      return disk.version;
    },
    hash,
    onRecord: (record) => {
      records.push(record);
      if (typeof record.content === "string") {
        remember({ contentHash: record.contentHash, markdown: record.content });
      }
    },
    onConflict: conflicts,
    onStatus: (status) => { statuses.push(status); },
    debounceMs: options.debounceMs ?? 5,
  });
  writers.push(writer);
  writer.start();

  const externalWrite = (content: string) => {
    disk.content = content;
    disk.version = token(nextModified++, content.length);
  };

  const checkpoint = vi.fn(async () => undefined);
  const conflictCopies: Array<{ content: string; label: string }> = [];
  const notifications: string[] = [];
  const ingest = () => ingestExternalChange({
    editor,
    document: doc,
    writer,
    fileName: "plan.md",
    readDisk: async (): Promise<DiskSnapshot> => ({ content: disk.content, version: disk.version }),
    hash,
    checkpoint,
    writeConflictCopy: async (content, label) => {
      conflictCopies.push({ content, label });
      return `/notes/plan (conflict ${label}).md`;
    },
    notify: (message) => { notifications.push(message); },
    generations: () => generations,
    remember,
  });

  const typeAtEnd = (text: string) => {
    editor.commands.focus("end");
    editor.commands.insertContent(text);
  };

  return {
    doc, editor, disk, writer, writes, records, statuses, conflicts, generations,
    externalWrite, ingest, checkpoint, conflictCopies, notifications, typeAtEnd,
  };
}

describe("MirrorWriter", () => {
  it("writes the document after the debounce with a version-only check and records the result", async () => {
    const m = await mirroredDocument("# Plan\n\nOne.\n");
    m.typeAtEnd(" Two.");
    expect(m.writer.status).toBe("pending");

    await wait(30);
    await m.writer.flush();

    expect(m.writes).toHaveLength(1);
    expect(m.writes[0].expectedVersion?.modified_ns).toBe("1");
    expect(m.writes[0].force).toBe(false);
    expect(m.writes[0].content).toBe("# Plan\n\nOne. Two.");
    expect(m.writer.record.version?.modified_ns).toBe("2");
    expect(m.writer.record.contentHash).toBe(await hash("# Plan\n\nOne. Two."));
    expect(m.records.at(-1)?.version).toEqual(m.writer.record.version);
    expect(m.writer.status).toBe("saved");
  });

  it("does not write while suspended, so ingestion never echoes", async () => {
    const m = await mirroredDocument("# Plan\n");
    m.writer.runSuspended(() => {
      m.editor.commands.insertContentAt(m.editor.state.doc.content.size, "<p>Agent</p>");
    });
    await wait(30);
    expect(m.writes).toHaveLength(0);
    expect(m.writer.status).toBe("saved");
  });

  it("reports a conflict instead of forcing when the disk moved under it", async () => {
    const m = await mirroredDocument("# Plan\n");
    m.externalWrite("# Plan\n\nSomeone else.\n");
    m.typeAtEnd(" Mine.");
    await wait(30);
    await m.writer.flush().catch(() => undefined);

    expect(m.writes).toHaveLength(1);
    expect(m.conflicts).toHaveBeenCalledTimes(1);
    expect(m.writer.status).toBe("conflict");
    expect(m.disk.content).toBe("# Plan\n\nSomeone else.\n");
  });
});

describe("ingestExternalChange", () => {
  it("replaces an unchanged document from disk after a checkpoint, without writing back", async () => {
    const m = await mirroredDocument("# Plan\n\nOne.\n\nThree.\n");
    m.externalWrite("# Plan\n\nOne.\n\nTwo.\n\nThree.\n");

    expect(await m.ingest()).toBe("replace");

    expect(m.checkpoint).toHaveBeenCalledWith("external_write");
    expect(serializeMarkdownDocument(m.editor)).toBe("# Plan\n\nOne.\n\nTwo.\n\nThree.");
    expect(m.writer.record.version?.modified_ns).toBe(m.disk.version.modified_ns);
    await wait(30);
    expect(m.writes).toHaveLength(0);
  });

  it("ignores Ghost's own write and records formatting-only changes", async () => {
    const m = await mirroredDocument("# Plan\n\n- one\n- two\n");
    expect(await m.ingest()).toBe("ignore");

    m.externalWrite("Plan\n====\n\n* one\n* two\n");
    expect(await m.ingest()).toBe("record-disk");
    expect(m.writer.record.version?.modified_ns).toBe(m.disk.version.modified_ns);
    expect(m.checkpoint).not.toHaveBeenCalled();
    await wait(30);
    expect(m.writes).toHaveLength(0);
    expect(m.disk.content).toBe("Plan\n====\n\n* one\n* two\n");
  });

  it("keeps the document and saves the disk copy beside it when both changed", async () => {
    const m = await mirroredDocument("# Plan\n\nOne.\n", { debounceMs: 10_000 });
    m.typeAtEnd(" Mine.");
    m.externalWrite("# Plan\n\nOne. Theirs.\n");

    expect(await m.ingest()).toBe("conflict");

    expect(m.conflictCopies).toHaveLength(1);
    expect(m.conflictCopies[0].content).toBe("# Plan\n\nOne. Theirs.\n");
    expect(m.conflictCopies[0].label).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}\.\d{2}$/);
    expect(m.disk.content).toBe("# Plan\n\nOne. Mine.");
    expect(m.writes.at(-1)?.force).toBe(true);
    expect(m.notifications[0]).toContain("Kept your version of plan.md");
    expect(m.writer.status).toBe("saved");
  });

  it("merges non-overlapping edits from both sides instead of copying", async () => {
    const m = await mirroredDocument("# Plan\n\nOne.\n\nTwo.\n\nThree.\n", { debounceMs: 10_000 });
    m.editor.commands.focus("end");
    m.editor.commands.insertContent("<p>Mine at the end.</p>");
    m.externalWrite("# Plan\n\nOne, edited by an agent.\n\nTwo.\n\nThree.\n");

    expect(await m.ingest()).toBe("merge");

    expect(serializeMarkdownDocument(m.editor)).toBe(
      "# Plan\n\nOne, edited by an agent.\n\nTwo.\n\nThree.\n\nMine at the end.",
    );
    expect(m.conflictCopies).toHaveLength(0);
    expect(m.checkpoint).toHaveBeenCalledWith("external_write");
    // The disk lacked our paragraph, so the merged document was written back.
    expect(m.writes.at(-1)?.force).toBe(true);
    expect(m.disk.content).toBe(serializeMarkdownDocument(m.editor));
  });

  it("restores our edit when an agent overwrites the file with a stale copy", async () => {
    const m = await mirroredDocument("# Plan\n\nOne.\n\nTwo.\n");
    m.typeAtEnd(" Mine.");
    await wait(30);
    await m.writer.flush();
    expect(m.disk.content).toBe("# Plan\n\nOne.\n\nTwo. Mine.");

    // The agent read the file before our write and rewrote it from that copy.
    m.externalWrite("# Plan\n\nOne, from the agent.\n\nTwo.\n");

    expect(await m.ingest()).toBe("merge");

    expect(serializeMarkdownDocument(m.editor)).toBe("# Plan\n\nOne, from the agent.\n\nTwo. Mine.");
    expect(m.disk.content).toBe("# Plan\n\nOne, from the agent.\n\nTwo. Mine.");
    expect(m.conflictCopies).toHaveLength(0);
  });

  it("puts our edit back on disk when another app saves an unchanged stale copy", async () => {
    const m = await mirroredDocument("# Plan\n\nOne.\n");
    m.typeAtEnd(" Mine.");
    await wait(30);
    await m.writer.flush();

    m.externalWrite("# Plan\n\nOne.\n");

    expect(await m.ingest()).toBe("merge");
    expect(m.disk.content).toBe("# Plan\n\nOne. Mine.");
    expect(serializeMarkdownDocument(m.editor)).toBe("# Plan\n\nOne. Mine.");
    expect(m.checkpoint).not.toHaveBeenCalled();
  });

  it("still copies the other version aside when the same block changed on both sides", async () => {
    const m = await mirroredDocument("# Plan\n\nOne.\n", { debounceMs: 10_000 });
    m.typeAtEnd(" Mine.");
    m.externalWrite("# Plan\n\nOne. Theirs.\n");

    expect(await m.ingest()).toBe("conflict");
    expect(m.conflictCopies[0]?.content).toBe("# Plan\n\nOne. Theirs.\n");
    expect(m.disk.content).toBe("# Plan\n\nOne. Mine.");
  });

  it("serialises overlapping runs through the queue", async () => {
    const m = await mirroredDocument("# Plan\n");
    const queue = new IngestionQueue();
    const order: string[] = [];
    const first = queue.run(async () => {
      await wait(20);
      order.push("first");
      return m.ingest();
    });
    const second = queue.run(async () => {
      order.push("second");
      return m.ingest();
    });
    await Promise.all([first, second]);
    expect(order).toEqual(["first", "second"]);
  });
});
