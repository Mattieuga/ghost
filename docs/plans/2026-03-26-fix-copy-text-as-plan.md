---
title: "fix: Copy Text As functionality"
type: fix
date: 2026-03-26
---

# Copy Text As — Plain Text, Markdown, Rich Text

## Two locations

### 1. Sidebar file context menu (existing, fix)
- "Copy Text As" submenu already exists on file right-click
- Currently broken — needs to read the whole file and copy in the selected format
- Plain Text: raw file content stripped of markdown syntax
- Markdown: raw file content as-is
- Rich Text: render markdown to HTML, copy with text/html MIME type

### 2. Editor right-click context menu (new)
- Custom Radix ContextMenu wrapping the editor
- Shows when right-clicking in the editor area
- Standard items: Cut, Copy, Paste, Select All
- "Copy Text As" submenu: copies the SELECTED text (not whole file)
- If no selection, "Copy Text As" and Cut/Copy are disabled
- Uses Tiptap APIs to extract selection in each format:
  - Plain text: `editor.state.doc.textBetween(from, to)`
  - Markdown: `editor.storage.markdown.serializer.serialize(tempDoc)`
  - Rich text: `getHTMLFromFragment(slice.content, editor.schema)`

## Implementation

### Step 1: Fix sidebar "Copy Text As"
- File: `src/components/sidebar/file-item.tsx`
- `handleCopyTextAs` already exists but needs fixing
- Plain Text: read file, strip to plain (or just copy raw — markdown IS text)
- Markdown: read file, copy raw content
- Rich Text: read file, render to HTML via a temporary Tiptap instance or simple markdown-to-HTML lib, copy with ClipboardItem

### Step 2: Create EditorContextMenu component
- New file: `src/components/editor/editor-context-menu.tsx`
- Wraps EditorContent with Radix ContextMenu
- Cut/Copy/Paste via `document.execCommand`
- Copy Text As submenu extracts selection in 3 formats
- Select All via `editor.chain().focus().selectAll().run()`

### Step 3: Wire it into MarkdownEditor
- File: `src/components/editor/markdown-editor.tsx`
- Wrap `<EditorContent>` in `<EditorContextMenu editor={editor}>`

## Key technical details

- Rich text clipboard: use `navigator.clipboard.write()` with `ClipboardItem` containing both `text/html` and `text/plain` blobs
- Safari/WebKit: ClipboardItem must be created synchronously in user gesture handler
- `getHTMLFromFragment` from `@tiptap/core` for HTML extraction
- Markdown serializer from `tiptap-markdown` storage for markdown extraction
- Cannot modify native WebKit context menu — must replace entirely with custom Radix menu

## Acceptance criteria
- [ ] Sidebar: Copy Text As Plain Text copies whole file as plain text
- [ ] Sidebar: Copy Text As Markdown copies whole file as raw markdown
- [ ] Sidebar: Copy Text As Rich Text copies whole file as HTML (pasteable into Docs/Word)
- [ ] Editor: Right-click shows custom context menu with Cut, Copy, Paste, Copy Text As, Select All
- [ ] Editor: Copy Text As copies only the selected text
- [ ] Editor: Copy Text As disabled when no text is selected
- [ ] Pasting rich text into Google Docs preserves formatting
