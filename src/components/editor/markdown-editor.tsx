import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Link from "@tiptap/extension-link";
import Focus from "@tiptap/extension-focus";
import Underline from "@tiptap/extension-underline";
import Highlight from "@tiptap/extension-highlight";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import { ResizableImage } from "./image-extension";
import { Markdown } from "tiptap-markdown";
import { SearchAndReplace } from "./search-and-replace";
import { CollapsibleHeadings } from "./collapsible-headings";
import { useEffect, useRef, useCallback } from "react";
import { DOMSerializer } from "@tiptap/pm/model";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { LinkBubbleMenu } from "./link-bubble-menu";
import { ensureProtocol } from "./floating-toolbar";
import { ImageBubbleMenu } from "./image-bubble-menu";
import { FloatingToolbar } from "./floating-toolbar";
import "./editor-styles.css";

interface MarkdownEditorProps {
  content: string;
  onContentChange: (markdown: string) => void;
  searchTerm?: string;
  replaceTerm?: string;
  onSearchResults?: (count: number, currentIndex: number) => void;
  activeFile?: string;
  showStyleBar?: boolean;
  onToggleStyleBar?: () => void;
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
}: MarkdownEditorProps) {
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSearchResults = useRef({ count: 0, index: 0 });

  // Expose active file path for image save handler
  useEffect(() => {
    window.__ghostActiveFile = activeFile ?? undefined;
    return () => { delete window.__ghostActiveFile; };
  }, [activeFile]);

  const debouncedSave = useCallback(
    (markdown: string) => {
      if (saveTimeout.current) {
        clearTimeout(saveTimeout.current);
      }
      saveTimeout.current = setTimeout(() => {
        onContentChange(markdown);
      }, 1000);
    },
    [onContentChange]
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5, 6] },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
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
        html: true,
        tightLists: true,
        bulletListMarker: "-",
        transformPastedText: true,
        transformCopiedText: false,
      }),
      Underline,
      Highlight,
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      SearchAndReplace,
      CollapsibleHeadings,
    ],
    content: "",
    onUpdate: ({ editor }) => {
      const markdown = editor.storage.markdown.getMarkdown();
      debouncedSave(markdown);
    },
    onTransaction: ({ editor }) => {
      if (!onSearchResults) return;
      const { results, resultIndex } = editor.storage.searchAndReplace;
      const count = results.length;
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
        // Cmd+C for rich text copy
        if ((event.metaKey || event.ctrlKey) && event.key === "c" && !event.shiftKey) {
          const { from, to } = view.state.selection;
          if (from !== to) {
            event.preventDefault();
            const slice = view.state.doc.slice(from, to);
            const serializer = DOMSerializer.fromSchema(view.state.schema);
            const div = document.createElement("div");
            div.appendChild(serializer.serializeFragment(slice.content));
            import("@tauri-apps/plugin-clipboard-manager").then(({ writeHtml }) => {
              writeHtml(div.innerHTML);
            });
            return true;
          }
        }
        // Cmd+S for immediate save (but not Cmd+Shift+S which is strikethrough)
        if ((event.metaKey || event.ctrlKey) && event.key === "s" && !event.shiftKey) {
          event.preventDefault();
          if (saveTimeout.current) {
            clearTimeout(saveTimeout.current);
          }
          const md = editor?.storage.markdown.getMarkdown();
          if (md !== undefined) {
            onContentChange(md);
          }
          return true;
        }
        return false;
      },
    },
  });

  // Flush pending save when window loses focus (ensures other windows see latest content)
  useEffect(() => {
    const handleBlur = () => {
      if (saveTimeout.current) {
        clearTimeout(saveTimeout.current);
        saveTimeout.current = null;
        const md = editor?.storage.markdown?.getMarkdown();
        if (md !== undefined) {
          onContentChange(md);
        }
      }
    };
    window.addEventListener("blur", handleBlur);
    return () => window.removeEventListener("blur", handleBlur);
  }, [editor, onContentChange]);

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
      editor.commands.setContent(content);
      contentSet.current = true;
    }
  }, [editor]);

  // Expose flush function for updater (and other consumers) to force-save before relaunch
  useEffect(() => {
    window.__ghostFlushSave = async () => {
      if (saveTimeout.current) {
        clearTimeout(saveTimeout.current);
        saveTimeout.current = null;
      }
      const md = editor?.storage.markdown.getMarkdown();
      if (md !== undefined) {
        await onContentChange(md);
      }
    };
    return () => { delete window.__ghostFlushSave; };
  }, [editor, onContentChange]);

  // Listen for flush-saves event (broadcast to all windows before relaunch)
  useEffect(() => {
    const unlisten = listen("flush-saves", () => {
      if (saveTimeout.current) {
        clearTimeout(saveTimeout.current);
        saveTimeout.current = null;
      }
      const md = editor?.storage.markdown.getMarkdown();
      if (md !== undefined) {
        onContentChange(md);
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [editor, onContentChange]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeout.current) {
        clearTimeout(saveTimeout.current);
      }
    };
  }, []);

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
      next: () => editor?.commands.nextSearchResult(),
      previous: () => editor?.commands.previousSearchResult(),
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

      const { writeText, writeHtml } = await import("@tauri-apps/plugin-clipboard-manager");

      if (format === "plain") {
        const text = editor.state.doc.textBetween(from, to, "\n");
        await writeText(text);
      } else if (format === "markdown") {
        // Get just the selected portion — serialize the slice
        const slice = editor.state.doc.slice(from, to);
        const tempDoc = editor.schema.topNodeType.create(null, slice.content);
        try {
          const selectedMd = editor.storage.markdown.serializer.serialize(tempDoc);
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
      {editor && showStyleBar && <FloatingToolbar editor={editor} onHide={() => onToggleStyleBar?.()} />}
    </div>
  );
}
