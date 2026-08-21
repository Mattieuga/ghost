---
title: "feat: Keyboard-first navigation"
type: feat
date: 2026-08-20
---

# Keyboard-first navigation

## Goal

Make every frequent navigation and file-tree task possible without leaving the keyboard, while following familiar macOS editor conventions and preserving Ghost's lightweight UI.

## Interaction model

### Global navigation

| Shortcut | Action |
| --- | --- |
| `Cmd-P` | Go to a file; press repeatedly to cycle results |
| `Shift-Cmd-P` or `Cmd-K` | Open the command palette |
| `Shift-Cmd-F` | Search across file contents |
| `Shift-Cmd-E` | Reveal and focus the active file in the tree |
| `Cmd-1` | Focus the editor or active viewer |
| `Cmd-\` | Toggle the sidebar |
| `Control-Tab` / `Control-Shift-Tab` | Cycle recent files |
| `Control--` / `Control-Shift--` | Navigate back / forward through opened files |

### File tree

The tree uses a single Tab stop and the standard accessible tree pattern.

| Key | Action |
| --- | --- |
| `Up` / `Down` | Move between visible items |
| `Right` | Expand a folder, then enter its first child |
| `Left` | Collapse a folder, then move to its parent |
| `Home` / `End` | Move to the first / last visible item |
| Type characters | Jump by item name |
| `Space` | Preview a file while retaining tree focus |
| `Return` | Open a file and focus the editor; toggle a folder |
| `Cmd-Return` | Open a file in a new window |
| `F2` | Rename |
| `Cmd-D` | Duplicate |
| `Cmd-Delete` | Move to Trash |
| `Escape` | Return to the editor |

## Implementation phases

1. Add an accessible, roving-focus file tree with active-file reveal and contextual file actions.
2. Separate the existing palette into Go to File, Search Contents, and Commands modes.
3. Add recent-file cycling and back/forward navigation, including rename/delete retargeting.
4. Expose the commands in the native macOS menu bar and command palette.
5. Add focused component tests, run the full web/Rust build, and smoke-test the local Tauri app.

## Acceptance checks

- A user can launch the app, choose a project, find/open/rename/duplicate/delete files, switch files, search the workspace, and return to editing without using the mouse.
- Tree focus is visually distinct from the file currently open in the editor.
- Expanding a collapsed project while focusing the active file works through nested folders.
- Renamed and deleted paths do not remain in recent, back, or forward navigation.
- Dialogs and palettes restore focus to the originating surface when closed.
- Every global shortcut is visible in either the native menu or command palette.
- Existing Markdown round-trip, image, table, and file-viewer behavior remains unchanged.
