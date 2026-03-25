---
title: trafficLightPosition y value is not pixels from top — it's extra height above button
category: ui-bugs
tags: [tauri, macos, traffic-lights, titlebar, wry, tao]
module: ghost
date: 2026-03-24
severity: major
symptoms:
  - trafficLightPosition config appears to have no effect
  - Traffic lights stay at default position despite setting y value
  - Custom title bar height doesn't match traffic light vertical position
---

# trafficLightPosition y Value Meaning in Tauri v2

## Problem

Setting `trafficLightPosition: { x: 18, y: 18 }` in `tauri.conf.json` appeared to have no effect. The traffic lights stayed at their default position. Multiple restart attempts confirmed the config was being ignored — or so it seemed.

## Root Cause

The `y` value is **not** "pixels from the top of the window to the button." It is **extra height added above the button** to expand the native titlebar container.

The formula (in wry's `inset_traffic_lights` function):

```
titlebar_container_height = button_height (14px) + y
```

With `y: 18`:
```
14 + 18 = 32px  ← same as the default Overlay titlebar height
```

That's why "nothing changed" — the calculated height was identical to the default.

## The Fix

For a 40px custom title bar, solve for y:

```
40 = 14 + y  →  y = 26
```

```json
{
  "trafficLightPosition": {
    "x": 18,
    "y": 26
  }
}
```

### Reference Table

| Desired titlebar height | y value | Notes |
|---|---|---|
| 32px (default) | 18 | Same as not setting it |
| 36px | 22 | |
| 40px | 26 | Ghost editor design |
| 48px | 34 | |
| 56px | 42 | |

## Code Path (traced through source)

1. **Config** (`tauri-utils/config.rs:1790`): `WindowConfig` uses `#[serde(rename_all = "camelCase")]` so `trafficLightPosition` maps to `traffic_light_position: Option<LogicalPosition>`

2. **Window builder** (`tauri-runtime-wry/lib.rs:848`): Calls `window.traffic_light_position(pos)` → stores via `with_traffic_light_inset`

3. **Webview attributes** (`tauri-runtime/webview.rs:444`): Also passes position to wry webview builder

4. **wry native code** (`wry/wkwebview/class/wry_web_view_parent.rs:76-110`): `inset_traffic_lights()` does:
   - Gets close/minimize/zoom buttons from `NSWindow.standardWindowButton`
   - Sets `title_bar_frame_height = close_button_height + y`
   - Resizes the titlebar container to this height
   - Sets `button.origin.x = x + (i * spacing)`
   - Does NOT set button y — macOS auto-centers buttons in the container

## Requirements

- `titleBarStyle: "Overlay"` (required)
- `decorations: true` (required, is the default)
- Do NOT enable the `unstable` feature flag — [issue #14072](https://github.com/tauri-apps/tauri/issues/14072) causes buttons to get stuck at (0,0)

## What Did NOT Work

| Attempt | Why it failed |
|---|---|
| `y: 14` | Titlebar = 28px, smaller than default |
| `y: 18` | Titlebar = 32px, identical to default — no visible change |
| Rust `set_traffic_light_position()` | Method doesn't exist on WebviewWindow in v2.10.3 |
| Removing and re-adding the config | Config was always working, the value was just wrong |

## Prevention

When using `trafficLightPosition` in Tauri v2:

1. Remember: **y is an offset, not a position**. `y = desired_titlebar_height - 14`
2. The x value IS straightforward pixels from the left edge
3. macOS auto-centers buttons vertically within the container — you don't control individual button y positions
4. Test with an obviously large y value (like 50) first to confirm the config is being read, then dial it in

## Related

- [Tauri issue #14072: traffic_light_position broken with unstable feature](https://github.com/tauri-apps/tauri/issues/14072)
- [Tauri issue #14477: macOS Traffic Light Inconsistency](https://github.com/tauri-apps/tauri/issues/14477)
- [tauri-plugin-trafficlights-positioner](https://github.com/ItsEeleeya/tauri-plugin-trafficlights-positioner) (unnecessary since v2.4.0 unless you need runtime repositioning)
- `docs/solutions/ui-bugs/tauri-v2-window-dragging-overlay-titlebar.md` (companion fix)
