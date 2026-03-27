<p align="center">
  <img src="icon.png" width="128" height="128" alt="Ghost">
</p>

<h1 align="center">Ghost</h1>

<p align="center">A minimalist markdown editor for Mac.</p>

---

Type markdown, see rich text. Files live on your filesystem. No cloud, no database, no accounts. Some features still in development.

## Stack

- [Tauri v2](https://v2.tauri.app) — Rust backend, ~5MB app bundle
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
