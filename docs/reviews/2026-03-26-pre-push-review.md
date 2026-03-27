---
title: Pre-Push Code Review
date: 2026-03-26
---

# Pre-Push Code Review Findings

## P1 — Fix Before Push

- [x] 1. Remove 13 debug `eprintln!` in lib.rs + context_menu.rs
- [x] 2. Delete 6 dead files (~988 LOC): sidebar.tsx, sheet.tsx, scroll-area.tsx, skeleton.tsx, collapsible.tsx, use-mobile.ts + remove TooltipProvider from App.tsx + delete tooltip.tsx
- [x] 3. Fix `__ghostNewFile` dead menu handler — either implement or remove
- [x] 4. Fix Cargo.toml platform gating — pulldown-cmark and notify used unconditionally but under macOS-only deps
- [x] 5. Remove `selectedItem` dead state — tracked/passed through 6 components but never read
- [x] 6. Simplify redundant `RunEvent::Opened` branches in lib.rs

## P2 — Important (address soon)

- [x] 7. Enable CSP in tauri.conf.json (currently `null`)
- [x] 8. Path validation on all FS commands — validate_name rejects path separators and `..`
- [x] 9. Fix locale-dependent "Copy" matching in context_menu.rs — match by keyEquivalent "c" not title
- [x] 10. Duplicate force-move logic in layout.tsx — extracted confirmForceMove function
- [ ] 11. Duplicate "Copy Folder" / "Copy File Path" menu items (skipped — needs different fix)
- [ ] 12. Hardcoded hex values (~30 instances) should use CSS variables (deferred)
- [x] 13. Unbounded `while(true)` retry loops — all 5 locations now cap at 100 iterations
- [x] 14. Merge duplicate `.ghost-editor` CSS rules — consolidated caret-color, removed redundant :focus
- [x] 15. Remove unused `loaded` from useSettings
- [x] 16. Duplicate guide-line rendering — extracted into shared `guideLine` variable
- [ ] 16. Duplicate guide-line rendering in folder-tree.tsx (copy-pasted in rename vs normal)

## P3 — Future Improvements

- [ ] Decompose GhostLayout god component (723 lines, 17 useState) into Sidebar, HeaderBar, useActiveFile, useKeyboardShortcuts
- [ ] Use React context for shared tree state instead of 19-prop drilling (newlyCreatedFile/Folder, activeFile, onAddProject, activeDropFolder)
- [ ] Extract shared file operation hooks (handleRevealInFinder, handleCopyPath, handleDuplicate, handleDelete duplicated in file-item and folder-tree)
- [ ] Structured error types instead of string matching ("ALREADY_EXISTS")
- [ ] Move deletion to trash instead of permanent remove_dir_all
- [ ] Symlink detection/resolution in FS operations
- [ ] Use spawn_blocking for Rust FS commands (currently blocking async runtime)
- [ ] Unify theme persistence (localStorage + Tauri store dual source of truth)
- [ ] Static clipboard imports instead of dynamic
- [ ] Type-safe window bridge declarations (declare global instead of `(window as any)`)
- [ ] Fix `key={dir-${index}}` on DroppableFolder — should use stable key, not array index
- [ ] Add tests (zero test files currently)
