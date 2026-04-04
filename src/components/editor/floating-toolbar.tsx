import { useState, useRef, useEffect, useLayoutEffect } from "react";
import type { Editor } from "@tiptap/react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { handleImageFromPath } from "./image-extension";

interface ToolbarProps {
  editor: Editor;
  onHide: () => void;
}

// --- Shared util ---

export function ensureProtocol(url: string): string {
  return url.match(/^https?:\/\//) ? url : `https://${url}`;
}

// --- Dropdown wrapper ---

function ToolbarDropdown({ trigger, children }: {
  trigger: React.ReactNode;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handle = (e: MouseEvent) => {
      if (e.target instanceof Node && ref.current && !ref.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("mousedown", handle);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handle);
      document.removeEventListener("keydown", handleKey);
    };
  }, [isOpen]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onMouseDown={(e) => { e.preventDefault(); setIsOpen(!isOpen); }}
        className="toolbar-btn"
      >
        {trigger}
      </button>
      {isOpen && (
        <div className="toolbar-dropdown">
          {children}
        </div>
      )}
    </div>
  );
}

// --- Dropdown item ---

function DropdownItem({ label, shortcut, active, icon, onSelect }: {
  label: string;
  shortcut?: string;
  active?: boolean;
  icon?: React.ReactNode;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); onSelect(); }}
      className={`toolbar-dropdown-item ${active ? "active" : ""}`}
    >
      <span className="toolbar-dropdown-icon">{icon}</span>
      <span className="flex-1">{label}</span>
      {shortcut && <span className="toolbar-dropdown-shortcut">{shortcut}</span>}
    </button>
  );
}

// --- Main toolbar ---

export function FloatingToolbar({ editor, onHide }: ToolbarProps) {
  const isActive = (name: string, attrs?: Record<string, any>) => editor.isActive(name, attrs);
  const [centerX, setCenterX] = useState<number | null>(null);

  // useLayoutEffect so position is set before first paint (no flash at left edge)
  useLayoutEffect(() => {
    const update = () => {
      const editorEl = editor.view.dom.closest("[data-ghost-editor-root]");
      if (editorEl) {
        const rect = editorEl.getBoundingClientRect();
        setCenterX(rect.left + rect.width / 2);
      }
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [editor]);

  const insertImageFromPicker = async () => {
    try {
      const activeFile = window.__ghostActiveFile;
      if (!activeFile) return;
      const selected = await openDialog({
        multiple: false,
        title: "Select an image",
        filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"] }],
      });
      if (!selected || typeof selected !== "string") return;
      const relativePath = await handleImageFromPath(selected);
      if (relativePath) {
        editor.chain().focus().setImage({ src: relativePath }).run();
      }
    } catch (err) {
      console.error("Failed to insert image:", err);
    }
  };

  return (
    <div className="floating-toolbar" style={{ left: centerX ?? -9999, visibility: centerX ? "visible" : "hidden" }}>
      {/* Heading dropdown */}
      <ToolbarDropdown
        trigger={<>H<span className="toolbar-caret">▾</span></>}
      >
        <DropdownItem
          label="Paragraph" active={isActive("paragraph") && !isActive("heading")}
          icon={<span className="text-xs">¶</span>}
          onSelect={() => editor.chain().focus().setParagraph().run()}
        />
        {[1, 2, 3, 4, 5, 6].map((level) => (
          <DropdownItem
            key={level}
            label={`Heading ${level}`}
            active={isActive("heading", { level })}
            icon={<span className="text-xs font-bold">H{level}</span>}
            onSelect={() => editor.chain().focus().toggleHeading({ level: level as 1|2|3|4|5|6 }).run()}
          />
        ))}
      </ToolbarDropdown>

      {/* Block type dropdown */}
      <ToolbarDropdown
        trigger={
          <>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <circle cx="2.5" cy="4" r="1.5" stroke="none" /><line x1="6" y1="4" x2="14" y2="4" />
              <circle cx="2.5" cy="8" r="1.5" stroke="none" /><line x1="6" y1="8" x2="14" y2="8" />
              <circle cx="2.5" cy="12" r="1.5" stroke="none" /><line x1="6" y1="12" x2="14" y2="12" />
            </svg>
            <span className="toolbar-caret">▾</span>
          </>
        }
      >
        <DropdownItem label="Bullet List" shortcut="⌘⇧8" active={isActive("bulletList")}
          icon={<span>•</span>}
          onSelect={() => editor.chain().focus().toggleBulletList().run()} />
        <DropdownItem label="Ordered List" shortcut="⌘⇧7" active={isActive("orderedList")}
          icon={<span className="text-xs">1.</span>}
          onSelect={() => editor.chain().focus().toggleOrderedList().run()} />
        <DropdownItem label="Block Quote" shortcut="⌘⇧B" active={isActive("blockquote")}
          icon={<span className="text-xs font-bold">❝</span>}
          onSelect={() => editor.chain().focus().toggleBlockquote().run()} />
        <DropdownItem label="Task List" active={isActive("taskList")}
          icon={<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1" y="1" width="14" height="14" rx="2" /><path d="M4 8L7 11L12 5" /></svg>}
          onSelect={() => editor.chain().focus().toggleTaskList().run()} />
        <div className="toolbar-dropdown-separator" />
        <DropdownItem label="Separator"
          icon={<span className="text-xs">—</span>}
          onSelect={() => editor.chain().focus().setHorizontalRule().run()} />
      </ToolbarDropdown>

      <div className="toolbar-separator" />

      {/* Bold */}
      <button
        type="button"
        onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleBold().run(); }}
        className={`toolbar-btn ${isActive("bold") ? "active" : ""}`}
        title="Bold (⌘B)"
      >
        <span style={{ fontFamily: "Inter, -apple-system, sans-serif", fontWeight: 700, fontSize: 15 }}>B</span>
      </button>

      {/* Italic */}
      <button
        type="button"
        onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleItalic().run(); }}
        className={`toolbar-btn ${isActive("italic") ? "active" : ""}`}
        title="Italic (⌘I)"
      >
        <span style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontStyle: "italic", fontSize: 16, fontWeight: 400 }}>I</span>
      </button>

      <div className="toolbar-separator" />

      {/* Link */}
      <button
        type="button"
        onMouseDown={(e) => {
          e.preventDefault();
          if (isActive("link")) {
            editor.chain().focus().unsetLink().run();
          } else {
            editor.chain().focus().setLink({ href: "" }).run();
          }
        }}
        className={`toolbar-btn ${isActive("link") ? "active" : ""}`}
        title="Link (⌘K)"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6.5 8.5a3 3 0 004.2.4l2-2a3 3 0 00-4.2-4.2L7.2 4" />
          <path d="M9.5 7.5a3 3 0 00-4.2-.4l-2 2a3 3 0 004.2 4.2L8.8 12" />
        </svg>
      </button>

      {/* Table */}
      <button
        type="button"
        onMouseDown={(e) => {
          e.preventDefault();
          editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
        }}
        className="toolbar-btn"
        title="Insert Table"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="1" y="1" width="14" height="14" rx="2" />
          <line x1="1" y1="5.5" x2="15" y2="5.5" />
          <line x1="1" y1="10.5" x2="15" y2="10.5" />
          <line x1="5.5" y1="1" x2="5.5" y2="15" />
          <line x1="10.5" y1="1" x2="10.5" y2="15" />
        </svg>
      </button>

      {/* Image — file picker */}
      <button
        type="button"
        onMouseDown={(e) => { e.preventDefault(); insertImageFromPicker(); }}
        className="toolbar-btn"
        title="Insert Image"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="1" y="2" width="14" height="12" rx="2" />
          <circle cx="5" cy="6" r="1.5" />
          <path d="M15 11L11 7L4 14" />
        </svg>
      </button>

      {/* More menu (three dots) */}
      <ToolbarDropdown
        trigger={
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <circle cx="3" cy="8" r="1.5" />
            <circle cx="8" cy="8" r="1.5" />
            <circle cx="13" cy="8" r="1.5" />
          </svg>
        }
      >
        <DropdownItem label="Underline" shortcut="⌘U" active={isActive("underline")}
          icon={<span className="underline text-xs">U</span>}
          onSelect={() => editor.chain().focus().toggleUnderline().run()} />
        <DropdownItem label="Strikethrough" shortcut="⌘⇧S" active={isActive("strike")}
          icon={<span className="line-through text-xs">S</span>}
          onSelect={() => editor.chain().focus().toggleStrike().run()} />
        <DropdownItem label="Highlight" active={isActive("highlight")}
          icon={<span className="text-xs px-0.5 rounded bg-yellow-500/40">H</span>}
          onSelect={() => editor.chain().focus().toggleHighlight().run()} />
        <div className="toolbar-dropdown-separator" />
        <DropdownItem label="Code" shortcut="⌘E" active={isActive("code")}
          icon={<span className="text-xs font-mono">&gt;</span>}
          onSelect={() => editor.chain().focus().toggleCode().run()} />
        <DropdownItem label="Code Block" active={isActive("codeBlock")}
          icon={<span className="text-xs font-mono">{"{}"}</span>}
          onSelect={() => editor.chain().focus().toggleCodeBlock().run()} />
        <div className="toolbar-dropdown-separator" />
        <DropdownItem label="Hide Style Bar" shortcut="⌘⇧Y"
          icon={<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 2L14 14" /><circle cx="8" cy="8" r="5" /></svg>}
          onSelect={onHide} />
      </ToolbarDropdown>
    </div>
  );
}
