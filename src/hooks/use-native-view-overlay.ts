import { useEffect, useState } from "react";

export const NATIVE_VIEW_OVERLAY_ATTRIBUTE = "data-native-view-overlay";
const OVERLAY_SELECTOR = `[${NATIVE_VIEW_OVERLAY_ATTRIBUTE}]`;

/**
 * AppKit preview views are sibling views above WKWebView, so CSS z-index
 * cannot put a React portal over them. Track app overlays explicitly and let
 * native viewers hide themselves for the lifetime of the portal.
 */
export function useNativeViewOverlay(): boolean {
  const [active, setActive] = useState(
    () => typeof document !== "undefined" && document.querySelector(OVERLAY_SELECTOR) !== null,
  );

  useEffect(() => {
    const update = () => setActive(document.querySelector(OVERLAY_SELECTOR) !== null);
    update();
    const observer = new MutationObserver(update);
    // Portals are appended to body. Watching only its direct children avoids
    // running a document-wide query for unrelated mutations inside a viewer.
    observer.observe(document.body, { childList: true });
    return () => observer.disconnect();
  }, []);

  return active;
}
