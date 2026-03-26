import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Link from "@tiptap/extension-link";
import { Markdown } from "tiptap-markdown";
import { useEffect, useRef, useCallback } from "react";
import { DOMSerializer } from "@tiptap/pm/model";
import "./editor-styles.css";

interface MarkdownEditorProps {
  content: string;
  onContentChange: (markdown: string) => void;
}

export function MarkdownEditor({
  content,
  onContentChange,
}: MarkdownEditorProps) {
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      }),
      Markdown.configure({
        html: false,
        tightLists: true,
        bulletListMarker: "-",
        transformPastedText: true,
        transformCopiedText: false,
      }),
    ],
    content,
    onUpdate: ({ editor }) => {
      const markdown = editor.storage.markdown.getMarkdown();
      debouncedSave(markdown);
    },
    editorProps: {
      attributes: {
        class: "ghost-editor",
      },
      handleKeyDown: (_view, event) => {
        // Cmd+S for immediate save
        if ((event.metaKey || event.ctrlKey) && event.key === "s") {
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

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeout.current) {
        clearTimeout(saveTimeout.current);
      }
    };
  }, []);

  // Expose copy-as function for native context menu
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__ghostCopyAs = async (format: string) => {
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return () => { delete (window as any).__ghostCopyAs; };
  }, [editor]);

  return (
    <div className="h-full">
      <EditorContent editor={editor} className="h-full" />
    </div>
  );
}
