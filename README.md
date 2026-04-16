
<img src="icon.png" alt="Ghost" width="128">


# Ghost

A minimalist markdown editor for Mac.

---

Type markdown, see rich text. Files live on your filesystem. No cloud, no database, no accounts. Some features still in development.

## Download

Get the latest release at [ghosteditor.app](https://ghosteditor.app).

The app is not code-signed, so macOS will block it on first launch. After dragging Ghost to `/Applications`, remove the quarantine flag:

```sh
xattr -d com.apple.quarantine /Applications/Ghost.app
```

Then open it normally.

## Stack

- [Tauri v2](https://v2.tauri.app) — Rust backend, \~5MB app bundle
- [React 19](https://react.dev) + TypeScript
- [Tiptap](https://tiptap.dev) — ProseMirror-based editor
- [Tailwind CSS v4](https://tailwindcss.com) — OKLCH theme tokens
- [shadcn/ui](https://ui.shadcn.com) — accessible component primitives
- [@dnd-kit](https://dndkit.com) — pointer-event drag and drop

## Development

```bash
pnpm install
pnpm tauri dev
```

## Build

```bash
pnpm tauri build
```

Output: `src-tauri/target/release/bundle/macos/Ghost.app`

## License

MIT