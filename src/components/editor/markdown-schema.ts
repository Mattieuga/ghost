import { Editor, type AnyExtension } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import type * as Y from "yjs";
import StarterKit from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import Highlight from "@tiptap/extension-highlight";
import { TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { Markdown } from "@tiptap/markdown";
import { ResizableImage } from "./image-extension";
import { ResizableTable } from "./table-extension";
import { Frontmatter } from "./frontmatter-extension";

/**
 * The document schema Ghost's Markdown parser and serializer are defined
 * against, without any UI-only extensions. The interactive editor adds focus
 * tracking, find and replace, collapsible headings, and collaboration on top
 * of this same node and mark set, so a document parsed here can be applied to
 * a live editor unchanged.
 */
export interface MarkdownSchemaOptions {
  /** Bind the editor to this Yjs document's `default` fragment. */
  collaboration?: Y.Doc;
}

/** The Yjs fragment name every Ghost editor binds to. */
export const COLLABORATION_FIELD = "default";

export function markdownSchemaExtensions(options: MarkdownSchemaOptions = {}): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      link: false,
      trailingNode: false,
      underline: false,
      undoRedo: options.collaboration ? false : undefined,
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true }),
    ResizableImage.configure({ allowBase64: false }),
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
    ...(options.collaboration ? [
      Collaboration.configure({
        document: options.collaboration,
        field: COLLABORATION_FIELD,
        yUndoOptions: { trackedOrigins: [] },
      }),
    ] : []),
  ];
}

/**
 * A detached editor for parsing, serializing, and diffing Markdown outside
 * the visible editor: folder adoption, ingestion of files that are not open,
 * and tests. Pass a Yjs document to edit it through the same binding the
 * visible editor uses. Destroy it when done.
 */
export function createHeadlessMarkdownEditor(options: MarkdownSchemaOptions = {}): Editor {
  return new Editor({ extensions: markdownSchemaExtensions(options), content: "" });
}
