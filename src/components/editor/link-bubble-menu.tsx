import type { Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { useState, useRef, useCallback } from "react";
import { ExternalLink, Unlink } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { ensureProtocol } from "./floating-toolbar";

interface LinkBubbleMenuProps {
  editor: Editor;
}

export function LinkBubbleMenu({ editor }: LinkBubbleMenuProps) {
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const showRef = useRef(false);

  const syncFromEditor = useCallback(() => {
    try {
      if (!editor.isActive("link")) return;

      const linkMark = editor.getAttributes("link");
      setUrl(linkMark.href ?? "");

      const { from } = editor.state.selection;
      const $pos = editor.state.doc.resolve(from);
      const linkType = editor.schema.marks.link;
      const parentStart = $pos.start();
      let linkFrom = from;
      let linkTo = from;

      $pos.parent.forEach((child, childOffset) => {
        const pos = parentStart + childOffset;
        if (child.marks.find((m) => m.type === linkType && m.attrs.href === linkMark.href)) {
          linkFrom = Math.min(linkFrom, pos);
          linkTo = Math.max(linkTo, pos + child.nodeSize);
        }
      });

      setTitle(editor.state.doc.textBetween(linkFrom, linkTo));
    } catch {
      // Editor state not ready
    }
  }, [editor]);

  const applyChanges = useCallback(() => {
    if (!showRef.current) return;
    const trimmedUrl = url.trim();

    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .command(({ tr, state }) => {
        const { from, to } = state.selection;
        const linkType = state.schema.marks.link;
        let markFrom = from;
        let markTo = to;
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (node.isText && node.marks.find((m) => m.type === linkType)) {
            markFrom = Math.min(markFrom, pos);
            markTo = Math.max(markTo, pos + node.nodeSize);
          }
        });

        if (trimmedUrl) {
          const mark = linkType.create({ href: trimmedUrl });
          tr.insertText(title, markFrom, markTo);
          const newTo = markFrom + title.length;
          tr.addMark(markFrom, newTo, mark);
        } else {
          tr.removeMark(markFrom, markTo, linkType);
        }
        return true;
      })
      .run();
  }, [editor, title, url]);

  const removeLink = () => {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
  };

  const openLink = () => {
    const href = url.trim();
    if (!href || href.startsWith("#")) return;
    invoke("open_url", { url: ensureProtocol(href) });
  };

  const inputClass =
    "flex-1 min-w-0 h-6 bg-muted/40 rounded px-2 text-[13px] text-foreground placeholder:text-ring outline-none border border-ring/20 focus:border-ring/30";

  const btnClass =
    "flex-shrink-0 p-0.5 rounded hover:bg-muted/50 text-muted-foreground transition-colors";

  return (
    <BubbleMenu
      editor={editor}
      updateDelay={0}
      shouldShow={({ editor }) => {
        try { return editor.isActive("link"); } catch { return false; }
      }}
      options={{
        placement: "bottom-start",
        offset: 4,
        onShow: () => {
          showRef.current = true;
          requestAnimationFrame(syncFromEditor);
        },
        onHide: () => {
          showRef.current = false;
        },
      }}
    >
      <div
        className="flex items-center gap-1 rounded-lg border border-border bg-popover px-2 py-1.5 shadow-lg"
        onKeyDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") applyChanges();
            if (e.key === "Escape") editor.commands.focus();
          }}
          placeholder="Title..."
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className={inputClass}
        />
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") applyChanges();
            if (e.key === "Escape") editor.commands.focus();
          }}
          placeholder="URL..."
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className={inputClass}
        />
        {!url.startsWith("#") && (
          <button onClick={openLink} className={btnClass} title="Open link">
            <ExternalLink size={14} />
          </button>
        )}
        <button onClick={removeLink} className={btnClass} title="Remove link">
          <Unlink size={14} />
        </button>
      </div>
    </BubbleMenu>
  );
}
