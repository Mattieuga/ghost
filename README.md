
<img src="icon.png" alt="Ghost" width="128">


# Ghost

A minimalist markdown editor for Mac.

---

Type markdown, see rich text. Files live on your filesystem. No cloud, no database, no accounts. Some features still in development.

## Download

Get the latest release at [ghosteditor.app](https://ghosteditor.app).

Release builds are signed with an Apple Developer ID and notarized by Apple,
so they open normally under Gatekeeper after being copied to `/Applications`.

## Stack

- [Tauri v2](https://v2.tauri.app) — Rust backend, \~5MB app bundle
- [React 19](https://react.dev) + TypeScript
- [Tiptap](https://tiptap.dev) — ProseMirror-based editor
- [Tailwind CSS v4](https://tailwindcss.com) — OKLCH theme tokens
- [shadcn/ui](https://ui.shadcn.com) — accessible component primitives
- [@dnd-kit](https://dndkit.com) — pointer-event drag and drop

## Supported files

Ghost edits Markdown, source code, structured text, and UTF-8 text files, and
includes dedicated viewers for images, PDFs, fonts, audio, and video. See the
[supported file formats](docs/supported-file-formats.md) guide for the complete
matrix and media codec compatibility notes.

## Development

```bash
pnpm install
pnpm tauri dev
```

Run the automated checks with:

```bash
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml
```

## Build

```bash
pnpm tauri build
```

Output: `src-tauri/target/release/bundle/macos/Ghost.app`

Production releases are created by the tag-triggered GitHub Actions workflow;
see [RELEASING.md](RELEASING.md) for the signed and notarized release process.

## License

MIT
