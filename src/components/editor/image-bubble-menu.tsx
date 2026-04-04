import { BubbleMenu, type Editor } from "@tiptap/react";
import { useState, useRef, useCallback, useEffect } from "react";

interface ImageBubbleMenuProps {
  editor: Editor;
}

export function ImageBubbleMenu({ editor }: ImageBubbleMenuProps) {
  const [alt, setAlt] = useState("");
  const [src, setSrc] = useState("");
  const showRef = useRef(false);

  const syncFromEditor = useCallback(() => {
    const attrs = editor.getAttributes("image");
    setAlt(attrs.alt || "");
    setSrc(attrs.src || "");
    showRef.current = true;
  }, [editor]);

  // Re-sync when selection changes (clicking between images)
  useEffect(() => {
    const handleUpdate = () => {
      if (editor.isActive("image")) {
        syncFromEditor();
      }
    };
    editor.on("selectionUpdate", handleUpdate);
    return () => { editor.off("selectionUpdate", handleUpdate); };
  }, [editor, syncFromEditor]);

  const applyChanges = useCallback(() => {
    if (!showRef.current) return;
    editor.chain().focus().updateAttributes("image", { alt, src }).run();
  }, [editor, alt, src]);

  return (
    <BubbleMenu
      editor={editor}
      updateDelay={0}
      shouldShow={({ editor }) => editor.isActive("image")}
      tippyOptions={{
        placement: "bottom-start",
        offset: [0, 8],
        duration: 0,
        moveTransition: "",
        onShow: () => {
          syncFromEditor();
        },
        onHide: () => {
          showRef.current = false;
        },
      }}
    >
      <div
        className="flex items-center gap-1 rounded-lg border border-border bg-popover px-2 py-1.5 shadow-lg"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          type="text"
          value={alt}
          onChange={(e) => setAlt(e.target.value)}
          onBlur={applyChanges}
          onKeyDown={(e) => {
            if (e.key === "Enter") { applyChanges(); editor.commands.focus(); }
            if (e.key === "Escape") editor.commands.focus();
          }}
          placeholder="Alt text..."
          className="h-7 w-36 rounded-md border border-border bg-transparent px-2 text-xs text-card-foreground outline-none focus:border-ring caret-ghost-amber placeholder:text-muted-foreground"
        />
        <input
          type="text"
          value={src}
          onChange={(e) => setSrc(e.target.value)}
          onBlur={applyChanges}
          onKeyDown={(e) => {
            if (e.key === "Enter") { applyChanges(); editor.commands.focus(); }
            if (e.key === "Escape") editor.commands.focus();
          }}
          placeholder="Image source..."
          className="h-7 w-48 rounded-md border border-border bg-transparent px-2 text-xs text-card-foreground outline-none focus:border-ring caret-ghost-amber placeholder:text-muted-foreground"
        />
        {/* Delete image button */}
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            editor.chain().focus().deleteSelection().run();
          }}
          className="flex items-center justify-center size-7 rounded-md hover:bg-accent text-muted-foreground hover:text-destructive transition-colors"
          title="Delete image"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 4h12" />
            <path d="M5 4V2.5A.5.5 0 015.5 2h5a.5.5 0 01.5.5V4" />
            <path d="M3.5 4l.75 9.5a1 1 0 001 .5h5.5a1 1 0 001-.5L12.5 4" />
            <line x1="6.5" y1="7" x2="6.5" y2="11" />
            <line x1="9.5" y1="7" x2="9.5" y2="11" />
          </svg>
        </button>
      </div>
    </BubbleMenu>
  );
}
