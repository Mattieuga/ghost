---

## title: "feat: Cmd+K Global Search Palette" type: feat date: 2026-03-27

# feat: Cmd+K Global Search Palette

## Overview

Build a VS Code-style Cmd+K command palette for Ghost that provides fast file switching, file name search, cross-file content search, and a preview panel. The palette opens as an overlay from anywhere in the app, dims the editor backdrop, and supports keyboard-driven navigation.

## Problem Statement / Motivation

Ghost currently has no way to quickly jump between files without manually navigating the sidebar tree. For users with *many* files across multiple tracked folders, this is slow. A Cmd+K palette is the standard UX pattern for fast file access in modern editors.

The sidebar already has a non-functional search bar placeholder at `layout.tsx:603-609` showing "Search... Cmd+K" — this feature was always planned.

## Proposed Solution

A full-featured command palette component with four modes:

1. **Empty state** — shows recently opened files for fast switching
2. **File name search** (plain text) — fuzzy-matches file names from the loaded file tree
3. **Content search** (`#` prefix) — greps file contents via a new Rust backend command
4. **Preview panel** (Tab key) — split view showing rendered file content

### Design Reference (from screenshots)

StateTriggerSections ShownFooterOpened (empty)Cmd+KRECENT`↑↓ navigate ↵ open tab preview # content search`File searchType textFILES + CONTENT (async)keyboard hintsContent searchType `# query`MATCHES — N results`N matches across N files`PreviewTab on resultLeft: file list / Right: preview pane`↵ open`

## Technical Approach

### Architecture

```
┌─────────────────────────────────────────────────────┐
│ GhostLayout                                         │
│  state: commandPaletteOpen, recentFiles             │
│  passes: allFiles[], onFileSelect, settings         │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │ CommandPalette (internal state)               │  │
│  │  - query, mode, selectedIndex, previewOpen    │  │
│  │  - fileResults[], contentResults[]            │  │
│  │  - loading states                             │  │
│  │                                               │  │
│  │  ┌─────────────┐  ┌───────────────────────┐  │  │
│  │  │ Result List  │  │ Preview Panel         │  │  │
│  │  │ (sections)   │  │ (rendered markdown)   │  │  │
│  │  └─────────────┘  └───────────────────────┘  │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘

Rust backend:
  search_file_contents(query, directories, extensions) → Vec<ContentMatch>
  get_file_metadata(path) → { size, modified }
```

### Implementation Phases

#### Phase 1: Core Palette + File Name Search

**Goal:** Cmd+K opens a palette, shows recent files on empty state, fuzzy-searches file names, Enter opens file, Esc closes. This phase requires zero Rust changes — all data is already in memory.

**Files to create:**

- `src/components/command-palette/command-palette.tsx` — main palette component
- `src/components/command-palette/palette-input.tsx` — search input with mode detection
- `src/components/command-palette/result-list.tsx` — scrollable result list with sections
- `src/components/command-palette/result-item.tsx` — individual result row
- `src/hooks/use-recent-files.ts` — persists recent files via plugin-store
- `src/lib/fuzzy-search.ts` — lightweight fuzzy matching (no external dep)

**Files to modify:**

- `src/components/layout.tsx` — add Cmd+K shortcut, `commandPaletteOpen` state, wire up `allFiles` flattening, track recent files on `handleFileSelect`, render `<CommandPalette>`, make sidebar search bar clickable
- `src/types/ghost-window.d.ts` — add `__ghostCommandPalette` for native menu bridge
- `src/types.ts` — add `FlatFileEntry` type (path + name + folder display name)

**Key decisions:**

- **Fuzzy matching:** Custom lightweight implementation (score consecutive matches, word boundaries, exact prefix). No need for `fuse.js` — the search space is small (file names only, already in memory).
- **Recent files:** Stored as `recent-files` key in `@tauri-apps/plugin-store` settings. Max 20 entries, deduplicated by path, most-recent-first. Stale entries (deleted files) filtered at display time.
- **File flattening:** Walk all `FileEntry` trees from `useDirectory` results and collect into a flat `FlatFileEntry[]` for search. Recompute when `refreshTrigger` changes.
- **Palette state:** Internal to `CommandPalette` component. Parent only provides: `open`, `onClose`, `allFiles`, `recentFiles`, `onFileSelect`, `settings`.

**Keyboard behavior:**

KeyAction`Cmd+K`Toggle palette open/close`Esc`Close palette`↑` / `↓`Navigate results`Enter`Open selected file, close paletteClick outsideClose palette

**Visual spec:**

- Horizontally centered, \~15% from top of viewport
- Width: 580px, max-height: 70vh
- Dark semi-transparent backdrop (editor dims to \~40% opacity)
- Rounded container matching existing dialog styling
- Orange left-border accent on selected item (matches screenshots)
- Subdued folder path on right side of each result row
- Section headers: "RECENT", "FILES" in uppercase, muted color
- Scale+fade animation on open/close (matching existing dialog pattern)

**Acceptance criteria:**

- [x] Cmd+K opens palette from anywhere (editor focused, sidebar focused, no file open)

- [x] Cmd+K toggles (press again to close)

- [x] Empty state shows up to 20 recent files

- [x] Typing filters files by fuzzy name match across all tracked folders

- [x] Results show file name + relative folder path

- [x] Arrow keys navigate, Enter opens file

- [x] Esc and click-outside close palette

- [x] Sidebar search bar placeholder is clickable and opens palette

- [x] Palette closes existing in-editor Cmd+F search when opened

- [x] Respects `showAllFiles` setting (only .md files when false)

- [x] Recent files persist across app restarts

- [x] Opening a file from palette adds it to recent files

---

#### Phase 2: Content Search

**Goal:** Typing `# query` in the palette searches inside file contents via a new Rust command. Results show filename:line + text snippet with match highlighting.

**Files to create:**

- `src-tauri/src/commands/search.rs` — new Rust module for content search

**Files to modify:**

- `src-tauri/src/commands/mod.rs` — register search module
- `src-tauri/src/lib.rs` — register `search_file_contents` command
- `src-tauri/capabilities/default.json` — add permission if needed
- `src/components/command-palette/command-palette.tsx` — add content search mode
- `src/components/command-palette/content-result-item.tsx` — new result row with line number + snippet

**Rust command signature:**

```rust
#[tauri::command]
async fn search_file_contents(
    query: String,
    directories: Vec<String>,
    extensions: Option<Vec<String>>,
    max_results: Option<usize>,  // default 50
) -> Result<SearchResults, String>

struct SearchResults {
    matches: Vec<ContentMatch>,
    total_matches: usize,
    files_searched: usize,
}

struct ContentMatch {
    path: String,
    line_number: usize,
    line_text: String,       // full line content
    match_start: usize,      // char offset of match start within line
    match_end: usize,        // char offset of match end within line
}
```

**Search behavior:**

- Case-insensitive substring search (not regex)
- Minimum 2 characters after `#` before searching
- 300ms debounce for content search (file search remains instant)
- Cap at 50 results by default
- Skip binary files, respect extension filter
- Results grouped by file, sorted by relevance (number of matches per file, then alphabetical)

**UI changes in content search mode:**

- Section header changes to "MATCHES — N results"
- Each result shows: `filename :line_number` on first line, `...matched text snippet...` on second line
- Matched text within snippet is bold/highlighted
- Footer shows "N matches across N files"

**During file name search (plain text mode):**

- FILES section appears immediately (from in-memory fuzzy match)
- CONTENT section appears below, after a 300ms debounce, with a loading indicator
- Content results show same format as content search mode

**Acceptance criteria:**

- [x] Typing `# query` switches to content-only search mode

- [x] Content results show file name, line number, and text snippet

- [x] Matched text is highlighted within snippets

- [x] Results capped at 50, with total count shown

- [x] Search is case-insensitive

- [x] Minimum 2 chars before content search fires

- [x] 300ms debounce prevents excessive backend calls

- [ ] Respects `showAllFiles` extension filter

- [x] Plain text mode shows both FILES and CONTENT sections

- [x] Content section has loading indicator while searching

---

#### Phase 3: Preview Panel

**Goal:** Pressing Tab on a selected result opens a split view with rendered markdown preview, file metadata (size, modified date), and Enter to open.

**Files to create:**

- `src/components/command-palette/preview-panel.tsx` — preview pane with rendered content

**Files to modify:**

- `src-tauri/src/commands/fs.rs` — add `get_file_metadata` command
- `src-tauri/src/lib.rs` — register new command
- `src/components/command-palette/command-palette.tsx` — add preview split layout
- `src/components/command-palette/result-list.tsx` — adjust for split view width

**Rust command for metadata:**

```rust
#[tauri::command]
async fn get_file_metadata(path: String) -> Result<FileMetadata, String>

struct FileMetadata {
    size_bytes: u64,
    modified: String,  // ISO 8601 timestamp
}
```

**Preview panel layout:**

- When Tab is pressed, palette splits: \~40% file list on left, \~60% preview on right
- Preview shows: file name (bold), folder path (muted), rendered markdown content, file size, modified date
- Footer shows "↵ open"
- Content rendered via existing `markdown_to_html` Rust command, displayed in a styled container matching editor typography
- 150ms debounce before loading preview content (prevents excessive reads during rapid navigation)

**Keyboard behavior with preview open:**

KeyAction`Tab`Toggle preview panel on/off`↑` / `↓`Navigate results (preview updates)`Enter`Open selected file, close palette`Esc`Close entire palette`Shift+Tab`Close preview panel only

**Acceptance criteria:**

- [x] Tab opens preview split for the selected result

- [x] Preview shows rendered markdown content

- [x] Preview shows file name, folder path, size, and modified date

- [x] Tab toggles preview on/off

- [x] Arrow keys update preview as selection changes

- [x] 150ms debounce prevents excessive file reads

- [x] Preview works for markdown files

- [x] Non-markdown files show raw text preview

- [x] Shift+Tab closes just the preview

---

#### Phase 4: Command Mode (Future)

**Goal:** Typing `> command` in the palette shows and executes app commands. **Deferred — not in initial scope.**

Potential commands: toggle theme, toggle sidebar, open settings, export file, new file, new folder, reveal in Finder.

Requires designing a command registry pattern. Will be planned separately when Phase 1-3 are stable.

## Key Technical Decisions

### 1. Palette as its own component (not inline in GhostLayout)

`GhostLayout` already has 25+ state variables. The palette is ephemeral UI with complex internal state (query, mode, selection, preview, loading). Keeping it self-contained avoids bloating the parent.

**Parent provides:** `open`, `onClose`, `allFiles: FlatFileEntry[]`, `recentFiles: string[]`, `onFileSelect: (path: string) => void`, `showAllFiles: boolean`

**Palette owns:** query, selectedIndex, previewOpen, fileResults, contentResults, loading states.

### 2. Fuzzy matching on the frontend

File names are already loaded in memory via `useDirectory`. The search space is small (hundreds to low thousands of files for a markdown editor). A simple scoring algorithm (consecutive char bonus, word-boundary bonus, exact-prefix bonus) is sufficient. No external dependency needed.

### 3. Content search via single Rust `invoke` (not streaming)

Streaming partial results via Tauri events would be more responsive but adds significant complexity (event cleanup, result accumulation, cancellation). Given Ghost's use case (markdown files, moderate workspace sizes), a single `invoke` call with a result cap of 50 is fast enough. Can revisit if workspaces grow large.

### 4. Close in-editor Cmd+F when palette opens

Two overlapping search UIs is confusing. When Cmd+K opens, close `searchOpen` state. The in-editor search can be re-opened after the palette closes.

### 5. File tree flattening approach

Create a `useFlatFileList` hook that takes the per-folder `FileEntry[]` trees and recursively flattens them into `FlatFileEntry[]` with `useMemo`. Recomputes when file trees change (tracked via `refreshTrigger`). This avoids a new Rust command and reuses existing data.

```typescript
interface FlatFileEntry {
  name: string;          // "architecture.md"
  path: string;          // "/Users/mga/projects/src/architecture.md"
  folderDisplay: string; // "projects/src" (relative to tracked folder root)
}
```

## Dependencies & Risks

RiskLikelihoodImpactMitigationContent search slow on large workspacesMediumHighCap results at 50, 300ms debounce, minimum 2-char queryPalette re-renders bloating GhostLayoutMediumMediumSelf-contained component with internal stateTab key conflicts with editorLowMediumPalette captures Tab only when open; editor does not receive itRecent files reference deleted filesMediumLowFilter stale entries at display timeRadix focus restoration steals focusHighMediumUse `onCloseAutoFocus={(e) => e.preventDefault()}` per documented learningPending editor save races with file switchMediumHighFlush debounced save before switching files in `handleFileSelect`

## Gotchas from Institutional Learnings

1. **Radix focus theft** (`docs/learnings/radix-context-menu-focus-stealing.md`): Any Radix-based overlay must use `onCloseAutoFocus={(e) => e.preventDefault()}` to prevent focus being yanked back to the trigger element. Critical for the palette's search input focus.

2. **Tauri drag region** (`docs/learnings/tauri-v2-window-dragging-overlay-titlebar.md`): The palette backdrop must not interfere with the title bar drag region. Ensure the backdrop `div` does not cover the drag area, or add `pointer-events: none` on the title bar region when the palette is open.

3. **Tauri v2 capabilities**: Any new Rust command needs explicit permission in `src-tauri/capabilities/default.json`. The `search_file_contents` and `get_file_metadata` commands will need entries.

## Success Metrics

- Cmd+K -&gt; ↓ -&gt; Enter opens a recent file in under 200ms perceived latency
- File name search returns results instantly (&lt; 50ms) as user types
- Content search returns results within 500ms for a typical workspace (&lt; 1000 files)
- Palette feels native — keyboard navigation is instant, no visual jank

## References & Research

### Internal References

- Keyboard handler: `src/components/layout.tsx:289-375`
- Sidebar search placeholder: `src/components/layout.tsx:603-609`
- File tree type: `src/types.ts` (`FileEntry` interface)
- Existing Rust FS commands: `src-tauri/src/commands/fs.rs`
- Settings store: `src/hooks/use-settings.ts` (pattern for plugin-store)
- Recent files tracking: `src/hooks/use-tracked-folders.ts` (pattern to follow)
- Dialog component: `src/components/ui/dialog.tsx` (shadcn/ui Dialog)
- Window bridge: `src/types/ghost-window.d.ts`

### Documented Learnings

- Radix focus theft: `docs/learnings/radix-context-menu-focus-stealing.md`
- Tauri drag region: `docs/learnings/tauri-v2-window-dragging-overlay-titlebar.md`
- Architecture reference: `docs/learnings/ghost-build-learnings.md`