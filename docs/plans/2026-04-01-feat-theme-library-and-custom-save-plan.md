---
title: "feat: Theme library with presets, custom saves, and compact color editor"
type: feat
date: 2026-04-01
---

# Theme Library with Presets, Custom Saves, and Compact Color Editor

## Overview

Redesign the Themes settings tab: move the 5-color editor to the top in a compact layout, add a "Save Theme" button, and replace the current 3 presets with a full library of ~15 popular themes stored as JSON. User-saved themes appear at the top of the list.

## Changes

### 1. Theme Data → JSON file

Move built-in presets from inline TypeScript to a JSON file at `src/data/themes.json`. Each entry:

```json
{
  "id": "factory",
  "label": "Factory",
  "editorBg": "#09090b",
  "sidebarBg": "#0e0e10",
  "text": "#e4e4e7",
  "accent": "#f57c00",
  "heading": "#fafafa"
}
```

`theme-engine.ts` imports and exports this as `BUILTIN_THEMES`. The `ThemeColors` interface stays in `theme-engine.ts`.

### 2. Built-in Theme Library

Remove: `light`, `system`

Rename: `dark` → `Factory`

Add all of these (exact hex values to be researched/defined during implementation):

**Dark themes:**
- Factory (current dark, renamed)
- Dracula — purple/pink on charcoal
- Nord — cool blue-gray
- Monokai — warm orange/green on near-black
- Gruvbox Dark — retro warm browns
- Tokyo Night — blue-purple on dark blue
- Catppuccin Mocha — pastels on warm dark
- One Dark — Atom-style blue-purple accent
- Rosé Pine — muted pinks/golds on dark

**Light themes:**
- Solarized Light — warm cream
- Gruvbox Light — warm ivory with earthy tones
- GitHub Light — clean white, blue accents
- Catppuccin Latte — pastels on warm white

**Special:**
- Solarized Dark (already exists)
- Sepia — warm parchment feel

### 3. User-Saved Themes

Stored in Tauri store under key `"custom-themes"` as `Array<ThemeColors & { id: string; label: string }>`.

New hook or extension of `useSettings`:
- `savedThemes: ThemePreset[]` — loaded from store
- `saveTheme(label: string, colors: ThemeColors)` — generates id, persists
- `deleteSavedTheme(id: string)` — removes from store

### 4. Compact Color Editor (top of Themes tab)

Current layout: 5 rows with label + hex + color swatch. Takes a lot of vertical space.

New layout: single horizontal row of 5 color circles with labels underneath, plus a "Save Theme" button. Something like:

```
[●] [●] [●] [●] [●]  [Save Theme]
 Bg  Sb  Tx  Hd  Ac
```

Each circle is a clickable color swatch that opens the native color picker. Hex values shown on hover or not at all. Much more compact.

Below the row: a "Save Theme" button that opens a small inline input for the theme name, then saves.

### 5. Theme List (below color editor)

Show themes in sections:
1. **My Themes** (user-saved) — only shown if user has saved themes. Each has a delete button.
2. **Built-in** — all presets from `themes.json`

Each theme card stays the same mini-preview style but in a 2-column grid.

### 6. Settings Schema Update

```typescript
interface Settings {
  theme: string;           // preset id or user-saved theme id
  themeColors: ThemeColors; // active colors (always the source of truth)
  // ... rest unchanged
}
```

No change to how colors are applied — `themeColors` feeds `deriveTheme()` as before.

Custom themes stored separately under `"custom-themes"` key in the Tauri store (not inside Settings).

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/data/themes.json` | **Create** — all built-in theme presets |
| `src/lib/theme-engine.ts` | Modify — import from JSON, export `BUILTIN_THEMES`, remove inline presets |
| `src/hooks/use-custom-themes.ts` | **Create** — hook for saved theme CRUD |
| `src/components/settings/tabs/themes-tab.tsx` | Rewrite — compact color editor + save + theme list |
| `src/components/settings/theme-card.tsx` | Minor — add optional delete button prop |

## Acceptance Criteria

- [ ] Color editor is compact (single row of swatches) at top of Themes tab
- [ ] "Save Theme" button prompts for name and saves current colors
- [ ] Saved themes appear in "My Themes" section above built-in themes
- [ ] Saved themes can be deleted
- [ ] All ~15 built-in themes render correctly and are selectable
- [ ] Theme presets live in `src/data/themes.json`
- [ ] "Factory" replaces "Dark" as the default theme name
- [ ] No "Light" or "System" preset — only named themes
- [ ] Persists across app restart

## References

- Current theme engine: `src/lib/theme-engine.ts`
- Current themes tab: `src/components/settings/tabs/themes-tab.tsx`
- Settings hook: `src/hooks/use-settings.ts`
- Tauri store: `settings.json`
