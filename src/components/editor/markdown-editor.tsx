import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import Link from "@tiptap/extension-link";
import { Focus } from "@tiptap/extensions";
import Underline from "@tiptap/extension-underline";
import Highlight from "@tiptap/extension-highlight";
import {
  TableCell,
  TableHeader,
  TableRow,
} from "@tiptap/extension-table";
import { FindAndReplace } from "@tiptap/extension-find-and-replace";
import { Markdown } from "@tiptap/markdown";

import { ResizableImage } from "./image-extension";
import { ResizableTable } from "./table-extension";
import { Frontmatter } from "./frontmatter-extension";
import { parseMarkdownDocument } from "./frontmatter";
import {
  cachePendingMarkdownDocument,
  getPendingMarkdownDocument,
  isMarkdownDocumentDirty,
  markMarkdownDocumentClean,
  markMarkdownDocumentDirty,
  resetMarkdownDocumentState,
  serializeMarkdownContent,
  serializeMarkdownDocument,
} from "./markdown-source";
import { CollapsibleHeadings } from "./collapsible-headings";
import { useEffect, useRef, useCallback } from "react";
import { DOMSerializer } from "@tiptap/pm/model";
import { invoke } from "@tauri-apps/api/core";
import { writeText, writeHtml } from "@tauri-apps/plugin-clipboard-manager";
import { LinkBubbleMenu } from "./link-bubble-menu";
import { ensureProtocol } from "./floating-toolbar";
import { ImageBubbleMenu } from "./image-bubble-menu";
import { FloatingToolbar } from "./floating-toolbar";
import { TableControls } from "./table-controls";
import "./editor-styles.css";

/**
 * Watches for `[ ] ` or `[x] ` typed at the start of a bullet list item
 * and converts it into a task list item. Uses a PM plugin (not an InputRule)
 * so it can silently ignore non-matching contexts without blocking input.
 */
const BulletToTask = Extension.create({
  name: "bulletToTask",
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey("bulletToTask"),
        props: {
          handleTextInput(view, from, _to, text) {
            if (text !== " ") return false;
            const { state } = view;
            const $from = state.doc.resolve(from);
            // Must be inside a bulletList > listItem
            const listItem = $from.node(-1);
            const list = $from.node(-2);
            if (!list || list.type.name !== "bulletList" || listItem.type.name !== "listItem") return false;
            // Get text before cursor in this text block
            const blockStart = $from.start();
            const textBefore = state.doc.textBetween(blockStart, from, "\0");
            const match = textBefore.match(/^\[([x ])?\]$/);
            if (!match) return false;
            const checked = match[1] === "x";
            // Delete the `[ ]` or `[x]` text, then convert to task list
            editor
              .chain()
              .deleteRange({ from: blockStart, to: from })
              .toggleTaskList()
              .updateAttributes("taskItem", { checked })
              .run();
            return true;
          },
        },
      }),
    ];
  },
});

interface MarkdownEditorProps {
  content: string;
  onContentChange: (markdown: string) => void | Promise<void>;
  searchTerm?: string;
  replaceTerm?: string;
  onSearchResults?: (count: number, currentIndex: number) => void;
  activeFile?: string;
  showStyleBar?: boolean;
  onToggleStyleBar?: () => void;
  onEditorReady?: (editor: Editor | null) => void;
}

export function MarkdownEditor({
  content,
  onContentChange,
  searchTerm = "",
  replaceTerm = "",
  onSearchResults,
  activeFile,
  showStyleBar = true,
  onToggleStyleBar,
  onEditorReady,
}: MarkdownEditorProps) {
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushSaveRef = useRef<() => Promise<void>>(async () => undefined);
  const lastSearchResults = useRef({ count: 0, index: 0 });
  const onContentChangeRef = useRef(onContentChange);
  onContentChangeRef.current = onContentChange;

  // Expose active file path for image save handler
  useEffect(() => {
    window.__ghostActiveFile = activeFile ?? undefined;
    return () => { delete window.__ghostActiveFile; };
  }, [activeFile]);

  const persistMarkdown = useCallback(async (
    currentEditor: Editor,
    markdown: string,
    revision: number,
  ) => {
    await onContentChangeRef.current(markdown);
    markMarkdownDocumentClean(currentEditor, revision);
  }, []);

  const persistRevision = useCallback(async (
    currentEditor: Editor,
    revision: number,
  ) => {
    if (currentEditor.isDestroyed || !isMarkdownDocumentDirty(currentEditor)) return;
    const pending = getPendingMarkdownDocument(currentEditor);
    if (pending.revision !== revision) return;

    const markdown = pending.markdown ?? serializeMarkdownDocument(currentEditor);
    cachePendingMarkdownDocument(currentEditor, revision, markdown);
    await persistMarkdown(currentEditor, markdown, revision);
  }, [persistMarkdown]);

  const debouncedSave = useCallback((
    currentEditor: Editor,
    revision: number,
  ) => {
    if (saveTimeout.current) {
      clearTimeout(saveTimeout.current);
    }
    saveTimeout.current = setTimeout(() => {
      saveTimeout.current = null;
      void persistRevision(currentEditor, revision).catch(() => {});
    }, 1000);
  }, [persistRevision]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5, 6] },
        link: false,
        trailingNode: false,
        underline: false,
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      BulletToTask,
      Link.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        isAllowedUri: (url, ctx) =>
          url.startsWith("#") || ctx.defaultValidate(url),
      }),
      ResizableImage.configure({
        allowBase64: true,
      }),
      Focus.configure({
        className: "has-focus",
        mode: "deepest",
      }),
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
      FindAndReplace.configure({
        injectCSS: false,
        searchDebounceMs: 0,
      }),
      CollapsibleHeadings,
    ],
    content: "",
    onUpdate: ({ editor }) => {
      const revision = markMarkdownDocumentDirty(editor);
      debouncedSave(editor, revision);
    },
    onTransaction: ({ editor }) => {
      if (!onSearchResults) return;
      const { results, currentIndex } = editor.storage.findAndReplace;
      const count = results.length;
      const resultIndex = currentIndex ?? 0;
      if (count !== lastSearchResults.current.count || resultIndex !== lastSearchResults.current.index) {
        lastSearchResults.current = { count, index: resultIndex };
        onSearchResults(count, resultIndex);
      }
    },
    editorProps: {
      attributes: {
        class: "ghost-editor",
      },
      handleDOMEvents: {
        click: (view, event) => {
          const target = event.target as HTMLElement;

          // Try DOM-based detection first
          const domLink = target.closest?.("a");
          let href = domLink?.getAttribute("href") ?? null;

          // Fallback: check ProseMirror link marks at the click position
          if (!href) {
            const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
            if (!coords) return false;
            const $pos = view.state.doc.resolve(coords.pos);
            const linkMark =
              $pos.nodeBefore?.marks.find((m) => m.type.name === "link") ??
              $pos.nodeAfter?.marks.find((m) => m.type.name === "link");
            if (!linkMark) return false;
            href = linkMark.attrs.href;
          }

          if (!href) return false;
          event.preventDefault();

          // Local anchor link — scroll to matching heading
          if (href.startsWith("#")) {
            const anchor = href.slice(1).toLowerCase();
            const { doc } = view.state;
            let targetPos: number | null = null;
            doc.descendants((node, pos) => {
              if (targetPos !== null) return false;
              if (node.type.name === "heading") {
                const slug = node.textContent
                  .toLowerCase()
                  .replace(/[^\w\s-]/g, "")
                  .replace(/\s+/g, "-");
                if (slug === anchor || slug.startsWith(anchor + "-")) {
                  targetPos = pos;
                  return false;
                }
              }
            });
            if (targetPos !== null) {
              const domAtPos = view.domAtPos(targetPos);
              const el = domAtPos.node.childNodes[domAtPos.offset] as HTMLElement
                ?? domAtPos.node;
              el?.scrollIntoView({ behavior: "smooth", block: "start" });
            }
            return true;
          }

          // External link — open in system browser (add protocol if missing)
          invoke("open_url", { url: ensureProtocol(href) });
          return true;
        },
      },
      handleKeyDown: (view, event) => {
        // Cmd+C — copy as markdown
        if ((event.metaKey || event.ctrlKey) && event.key === "c" && !event.shiftKey) {
          const { from, to } = view.state.selection;
          if (from !== to) {
            event.preventDefault();
            const slice = view.state.doc.slice(from, to);
            const tempDoc = view.state.schema.topNodeType.create(null, slice.content);
            try {
              if (!editor) throw new Error("Markdown serializer unavailable");
              const md = serializeMarkdownContent(editor, tempDoc.toJSON());
              writeText(md);
            } catch {
              writeText(view.state.doc.textBetween(from, to, "\n"));
            }
            return true;
          }
        }
        // Cmd+S for immediate save (but not Cmd+Shift+S which is strikethrough)
        if ((event.metaKey || event.ctrlKey) && event.key === "s" && !event.shiftKey) {
          event.preventDefault();
          void flushSaveRef.current().catch(() => {});
          return true;
        }
        return false;
      },
    },
  });

  const flushPendingSave = useCallback(async () => {
    if (!editor || editor.isDestroyed || !isMarkdownDocumentDirty(editor)) return;
    if (saveTimeout.current) {
      clearTimeout(saveTimeout.current);
      saveTimeout.current = null;
    }

    const pending = getPendingMarkdownDocument(editor);
    await persistRevision(editor, pending.revision);
  }, [editor, persistRevision]);
  flushSaveRef.current = flushPendingSave;

  // Flush pending save when window loses focus (ensures other windows see latest content)
  useEffect(() => {
    const handleBlur = () => {
      void flushSaveRef.current().catch(() => {});
    };
    window.addEventListener("blur", handleBlur);
    return () => window.removeEventListener("blur", handleBlur);
  }, [editor]);

  // Sync search term from parent into editor extension
  useEffect(() => {
    if (!editor) return;
    editor.commands.setSearchTerm(searchTerm);
  }, [editor, searchTerm]);

  // Sync replace term from parent into editor extension
  useEffect(() => {
    if (!editor) return;
    editor.commands.setReplaceTerm(replaceTerm);
  }, [editor, replaceTerm]);

  // Set content only on initial mount (key={activeFile} handles file switches)
  // Do NOT depend on [editor] — Tiptap can recreate the editor reference
  // during re-renders, which would reset user's in-progress edits
  const contentSet = useRef(false);
  useEffect(() => {
    if (editor && !contentSet.current) {
      editor.commands.setContent(parseMarkdownDocument(editor, content), {
        emitUpdate: false,
      });
      resetMarkdownDocumentState(editor);
      contentSet.current = true;
    }
  }, [editor]);

  // Notify parent when editor instance is ready; clear on unmount
  useEffect(() => {
    if (editor) onEditorReady?.(editor);
    return () => onEditorReady?.(null);
  }, [editor, onEditorReady]);

  // Expose flush function for updater (and other consumers) to force-save before relaunch
  useEffect(() => {
    window.__ghostFlushSave = flushPendingSave;
    return () => { delete window.__ghostFlushSave; };
  }, [flushPendingSave]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      void flushSaveRef.current().catch(() => {});
    };
  }, [editor]);

  // Listen for image insertions from external drag-drop
  useEffect(() => {
    const handleInsertImage = (e: Event) => {
      if (!editor) return;
      const { src } = (e as CustomEvent).detail;
      editor.chain().focus().setImage({ src }).run();
    };
    window.addEventListener("ghost-insert-image", handleInsertImage);
    return () => window.removeEventListener("ghost-insert-image", handleInsertImage);
  }, [editor]);

  // Expose search commands for top bar and native menu
  useEffect(() => {
    window.__ghostSearch = {
      next: () => editor?.commands.goToNextResult(),
      previous: () => editor?.commands.goToPreviousResult(),
      replace: () => editor?.commands.replace(),
      replaceAll: () => editor?.commands.replaceAll(),
    };
    return () => { delete window.__ghostSearch; };
  }, [editor]);

  // Expose copy-as function for native context menu
  useEffect(() => {
    window.__ghostCopyAs = async (format: string) => {
      if (!editor) return;
      const { from, to } = editor.state.selection;
      if (from === to) return;

      if (format === "plain") {
        const text = editor.state.doc.textBetween(from, to, "\n");
        await writeText(text);
      } else if (format === "markdown") {
        // Get just the selected portion — serialize the slice
        const slice = editor.state.doc.slice(from, to);
        const tempDoc = editor.schema.topNodeType.create(null, slice.content);
        try {
          const selectedMd = serializeMarkdownContent(editor, tempDoc.toJSON());
          await writeText(selectedMd);
        } catch {
          // Fallback to full markdown if serializer fails on slice
          await writeText(editor.state.doc.textBetween(from, to, "\n"));
        }
      } else if (format === "rich") {
        const slice = editor.state.doc.slice(from, to);
        const serializer = DOMSerializer.fromSchema(editor.schema);
        const div = document.createElement("div");
        div.appendChild(serializer.serializeFragment(slice.content));
        await writeHtml(div.innerHTML);
      }
    };
    return () => { delete window.__ghostCopyAs; };
  }, [editor]);

  return (
    <div className="h-full relative" data-ghost-editor-root>
      {editor && <LinkBubbleMenu editor={editor} />}
      {editor && <ImageBubbleMenu editor={editor} />}
      <EditorContent editor={editor} className="h-full" />
      {editor && <TableControls editor={editor} />}
      {editor && showStyleBar && <FloatingToolbar editor={editor} onHide={() => onToggleStyleBar?.()} />}
    </div>
  );
}
