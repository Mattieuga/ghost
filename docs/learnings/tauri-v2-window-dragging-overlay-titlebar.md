---
title: Window dragging broken with Overlay titleBarStyle in Tauri v2
category: ui-bugs
tags: [tauri, macos, window-dragging, titlebar, webkit, permissions]
module: ghost
date: 2026-03-24
severity: critical
symptoms:
  - Window cannot be dragged by clicking the custom title bar area
  - data-tauri-drag-region attribute has no effect
  - WebkitAppRegion drag CSS property has no effect
---

# Window Dragging Broken with Overlay Title Bar in Tauri v2

## Problem

With `titleBarStyle: "Overlay"` in Tauri v2, the native title bar becomes transparent and content renders behind it. Custom HTML elements meant to be drag handles (using `data-tauri-drag-region`) don't work — the window cannot be dragged at all.

## Root Causes (Three independent issues, ALL must be fixed)

### 1. Missing IPC permission

Tauri v2's `data-tauri-drag-region` works by injecting a JavaScript file (`drag.js`) that listens for mousedown events and calls `window.__TAURI_INTERNALS__.invoke('plugin:window|start_dragging')`. This IPC call requires the `core:window:allow-start-dragging` permission.

The default `core:default` permission set does NOT include this. Without it, the IPC call is **silently rejected** — no error, no console warning, just nothing happens.

**Fix:** Add to `src-tauri/capabilities/default.json`:

```json
{
  "permissions": [
    "core:default",
    "core:window:allow-start-dragging"
  ]
}
```

### 2. Child elements eat mouse events

The injected `drag.js` checks `e.target.getAttribute('data-tauri-drag-region')` — it checks the **direct click target**, not the closest ancestor. If you have:

```html
<div data-tauri-drag-region>
  <span>ghost</span>
</div>
```

Clicking on "ghost" text means `e.target` is the `<span>`, which doesn't have the attribute. The drag never fires.

**Fix:** Add `pointer-events-none` to all child elements inside drag regions:

```html
<div data-tauri-drag-region>
  <span class="pointer-events-none select-none">ghost</span>
</div>
```

### 3. Missing CSS `app-region: drag` rule

WKWebView (macOS) supports the `app-region: drag` CSS property as a native drag mechanism. This acts as a backup alongside the JavaScript-based approach. Without it, dragging may be less reliable.

**Fix:** Add to global CSS:

```css
[data-tauri-drag-region] {
  app-region: drag;
}
```

Note: `-webkit-app-region: drag` (the Chromium/Electron variant) does NOT work in Tauri's WKWebView. Use the unprefixed `app-region: drag`.

## What Did NOT Work (Failed Attempts)

| Attempt | Why it failed |
|---|---|
| `-webkit-app-region: drag` CSS | Chromium-only property; Tauri uses WKWebView on macOS |
| `data-tauri-drag-region` alone without permission | IPC call silently rejected |
| `data-tauri-drag-region` with permission but child elements | `e.target` check fails on child spans |
| Custom mousedown + Tauri window API | No `startDragging()` method on WebviewWindow in v2.10.3 |

## Key Insight

Tauri v2's drag mechanism has **three independent requirements** that must ALL be satisfied:

1. **Permission**: `core:window:allow-start-dragging` in capabilities
2. **Attribute**: `data-tauri-drag-region` on the element
3. **No child event targets**: Children must have `pointer-events: none`

Plus the CSS `app-region: drag` as a backup for WKWebView.

Missing any ONE of these results in silent failure with no error messages.

## Known Limitations

- **Unfocused window**: On macOS, `data-tauri-drag-region` does NOT work when the window is out of focus ([Tauri issue #11605](https://github.com/tauri-apps/tauri/issues/11605)). The first click focuses the window; dragging works on the second click.
- **No error feedback**: All three failure modes are silent — no console errors, no exceptions.

## Prevention

When setting up a Tauri v2 app with a custom title bar:

1. Always add `core:window:allow-start-dragging` to capabilities alongside `core:default`
2. Never put interactive or text child elements inside `data-tauri-drag-region` without `pointer-events-none`
3. Always add the `app-region: drag` CSS rule as a global style
4. Test dragging early — don't wait until the end to verify it works

## References

- [Tauri Window Customization docs](https://v2.tauri.app/learn/window-customization/)
- [Tauri issue #9503 - Cannot drag window with Overlay](https://github.com/tauri-apps/tauri/issues/9503)
- [Tauri Core Permissions reference](https://v2.tauri.app/reference/acl/core-permissions/)
- Tauri source: `tauri-2.10.3/src/window/scripts/drag.js` (line 20: `e.target.getAttribute` check)
