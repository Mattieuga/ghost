---
title: WKWebView Context Menu Custom Item Appears at Bottom Instead of After Copy
category: ui-bugs
module: ghost
tags: [context-menu, wkwebview, tauri, macos, objc, willOpenMenu, NSMenu]
severity: major
symptoms:
  - Custom "Copy As..." submenu appears at bottom of context menu
  - Context menu item not positioned after Copy
  - keyEquivalent matching returns -1 for all WKWebView menu items
date_discovered: 2026-03-29
date_resolved: 2026-03-29
---

# WKWebView Context Menu Custom Item Appears at Bottom Instead of After Copy

## Problem

Custom "Copy As..." submenu injected via `willOpenMenu:withEvent:` ObjC hook on WKWebView appeared at the very bottom of the context menu instead of right after the "Copy" item where it was intended.

The item was being inserted at index `count` (end of menu) every time, despite the code searching for the Copy item to insert after it.

## Root Cause

**macOS WKWebView context menu items have empty `keyEquivalent` fields.**

The original code found the "Copy" item by matching `keyEquivalent == "c"`:

```rust
let key_equiv: *mut AnyObject = msg_send![item, keyEquivalent];
// ...
if key == "c" {
    copy_index = i;
    break;
}
```

Debug logging revealed that **every single item** in the WKWebView context menu has an empty `keyEquivalent`:

```
item[5]: title="Cut" key=""
item[6]: title="Copy" key=""
item[7]: title="Paste" key=""
```

This means `copy_index` was always `-1`, and the fallback `if copy_index >= 0 { copy_index + 1 } else { count }` always evaluated to `count`, appending the item at the end.

This likely worked in earlier macOS versions where WKWebView context menu items DID have keyboard equivalents set, but at some point (possibly macOS Sequoia / 15.x) Apple removed them.

## Investigation Steps Tried (What Didn't Work)

### 1. Changing insert anchor from Copy to Paste
Tried inserting after "Paste" (key equiv "v") instead of after "Copy" — same result because ALL items have empty keyEquivalent.

### 2. Deferred insertion via `dispatch_async` on main queue
Hypothesis: macOS adds system items after `willOpenMenu`, pushing our item down. Tried deferring with `dispatch_async(dispatch_get_main_queue(), block)`.
- **Failed**: Linker error — `dispatch_get_main_queue` symbol not found. Required `block2` crate dependency and linking against libdispatch.
- After fixing linker issues, this approach would have failed anyway because...

### 3. Deferred insertion via `performSelector:withObject:afterDelay:0`
Hypothesis: Same as above but using ObjC delayed perform instead of GCD.
- **Failed**: The item disappeared entirely. Context menus run their own **modal run loop** (`NSEventTrackingRunLoopMode`), and `performSelector:afterDelay:` schedules on `NSDefaultRunLoopMode`. The timer never fires while the menu is open.

### 4. Reverting `dragDropEnabled` to `false`
Hypothesis: Changing `dragDropEnabled` from `false` to `true` altered WKWebView class behavior and broke the hook.
- **No effect**: Same bottom positioning with either setting. Ruled out as the cause.

## Working Solution

Match the "Copy" item by **title** instead of **keyEquivalent**:

```rust
// Find "Copy" by title (WKWebView context menu items have no keyEquivalent)
let mut copy_index: isize = -1;
for i in 0..count {
    let item: *mut AnyObject = msg_send![menu, itemAtIndex: i];
    if item.is_null() { continue; }
    let title: *mut AnyObject = msg_send![item, title];
    if title.is_null() { continue; }
    let title_str: *const std::os::raw::c_char = msg_send![title, UTF8String];
    if title_str.is_null() { continue; }
    let t = std::ffi::CStr::from_ptr(title_str).to_string_lossy();
    if t == "Copy" {
        copy_index = i;
        break;
    }
}

let insert_index = if copy_index >= 0 { copy_index + 1 } else { count };
let _: () = msg_send![menu, insertItem: parent_item, atIndex: insert_index];
```

**Trade-off**: Title matching is locale-dependent ("Copy" is English-only). The previous `keyEquivalent` approach was locale-safe but broken. If localization is needed in the future, consider matching by the item's `action` selector (e.g., `copy:`) which is locale-independent.

## Key Learnings

1. **WKWebView context menu items have no `keyEquivalent` on modern macOS.** Never match by keyboard shortcut — match by title or action selector.

2. **Deferred insertion doesn't work with context menus.** Context menus run a modal run loop (`NSEventTrackingRunLoopMode`). Timers and dispatches scheduled on `NSDefaultRunLoopMode` are blocked until the menu closes. Synchronous insertion in `willOpenMenu:withEvent:` is the only reliable approach.

3. **Debug logging is essential for ObjC menu hooks.** Adding `eprintln!` to dump all menu items with their titles and keyEquivalents immediately revealed the root cause after hours of wrong hypotheses.

4. **`willOpenMenu:withEvent:` fires with the complete menu.** Despite the hypothesis that macOS adds items after the hook, the debug logs showed all system items (Writing Tools, Spelling, etc.) were already present when the hook fired. The items were always there — we just couldn't find "Copy" because we were searching the wrong field.

## Prevention

- When working with native macOS menu items, always verify assumptions about item properties with debug logging before building matching logic.
- Add a comment in `context_menu.rs` explaining why title matching is used instead of keyEquivalent.
- Consider adding an automated test or startup check that logs whether the Copy item was found at the expected index.

## Related Files

- `src-tauri/src/context_menu.rs` — The ObjC hook implementation
- `src-tauri/src/lib.rs:153` — Where the hook is installed during app setup
- `docs/learnings/radix-context-menu-focus-stealing.md` — Related: Radix JS-layer context menu issues

## References

- [iCab Blog: Customize the contextual menu of WKWebView on macOS](https://icab.de/blog/2022/06/12/customize-the-contextual-menu-of-wkwebview-on-macos/)
- [Apple: willOpenMenu(_:with:)](https://developer.apple.com/documentation/appkit/nsview/willopenmenu(_:with:))
- [Apple: NSMenuDelegate](https://developer.apple.com/documentation/appkit/nsmenudelegate)
