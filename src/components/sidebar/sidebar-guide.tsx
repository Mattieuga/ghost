import { useEffect, useRef, useState, useCallback } from "react";

interface GuideState {
  dotY: number;
  folderBottom: number;
  activeTop: number;
  activeBottom: number;
  rootFolder: string;
  guideX: number;
}

export function SidebarGuide({ treeAreaRef }: { treeAreaRef: React.RefObject<HTMLDivElement | null> }) {
  const [current, setCurrent] = useState<GuideState | null>(null);
  const [animating, setAnimating] = useState(false);
  const rafRef = useRef<number>(0);

  const measure = useCallback((): GuideState | null => {
    const treeArea = treeAreaRef.current;
    if (!treeArea) return null;

    const activeEl =
      treeArea.querySelector("[data-file-active]") ??
      treeArea.querySelector("[data-folder-active]");
    if (!activeEl) return null;

    const rootFolderEl = activeEl.closest("[data-root-folder]");
    if (!rootFolderEl) return null;

    const rootFolder = rootFolderEl.getAttribute("data-root-folder") ?? "";
    const dotEl = rootFolderEl.querySelector("[data-root-dot]");
    if (!dotEl) return null;

    const treeRect = treeArea.getBoundingClientRect();

    // Viewport-relative positions within the container (NO scrollTop adjustment)
    const activeRect = activeEl.getBoundingClientRect();
    const dotRect = dotEl.getBoundingClientRect();
    const folderRect = rootFolderEl.getBoundingClientRect();
    const guideX = dotRect.left - treeRect.left + dotRect.width / 2;

    return {
      dotY: dotRect.top - treeRect.top + dotRect.height / 2,
      folderBottom: folderRect.bottom - treeRect.top,
      activeTop: activeRect.top - treeRect.top,
      activeBottom: activeRect.top - treeRect.top + activeRect.height,
      rootFolder,
      guideX,
    };
  }, [treeAreaRef]);

  const update = useCallback((fromScroll = false) => {
    const newState = measure();
    setCurrent((prev) => {
      if (!newState) return null;

      // Only animate when the active file/folder changes, not during scroll
      if (!fromScroll && prev && (
        prev.rootFolder !== newState.rootFolder ||
        prev.activeTop !== newState.activeTop ||
        prev.activeBottom !== newState.activeBottom
      )) {
        setAnimating(true);
      }

      return newState;
    });
  }, [measure]);

  useEffect(() => {
    const treeArea = treeAreaRef.current;
    if (!treeArea) return;

    update();

    const observer = new MutationObserver(() => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => update(false));
    });
    observer.observe(treeArea, {
      attributeFilter: ["data-file-active", "data-folder-active", "data-root-active-collapsed"],
      childList: true,
      subtree: true,
    });

    const onScroll = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => update(true));
    };
    treeArea.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      observer.disconnect();
      treeArea.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(rafRef.current);
    };
  }, [treeAreaRef, update]);

  // Clear animating flag after transition completes
  useEffect(() => {
    if (animating) {
      const timer = setTimeout(() => setAnimating(false), 350);
      return () => clearTimeout(timer);
    }
  }, [animating]);

  if (!current) return null;

  const guideX = current.guideX;
  const lineTop = current.dotY;
  const lineHeight = Math.max(0, current.folderBottom - current.dotY);
  const activeSegTop = current.activeTop;
  const activeSegHeight = current.activeBottom - current.activeTop;

  const transition = animating
    ? "top 300ms cubic-bezier(0.4, 0, 0.2, 1), height 300ms cubic-bezier(0.4, 0, 0.2, 1)"
    : "none";

  return (
    <div
      className="absolute left-0 top-0 pointer-events-none z-[1]"
      style={{ width: "40px", height: "1px" }}
    >
      {/* Full project guide line (dim amber from dot to folder bottom) */}
      <div
        style={{
          position: "absolute",
          left: `${guideX - 0.75}px`,
          top: `${lineTop}px`,
          width: "1.5px",
          height: `${lineHeight}px`,
          backgroundColor: "var(--ghost-amber)",
          opacity: 0.45,
          borderRadius: "1px",
          transition,
        }}
      />

      {/* Bright segment on the active row */}
      <div
        style={{
          position: "absolute",
          left: `${guideX - 0.75}px`,
          top: `${activeSegTop}px`,
          width: "1.5px",
          height: `${activeSegHeight}px`,
          backgroundColor: "var(--ghost-amber)",
          opacity: 1,
          borderRadius: "1px",
          transition,
        }}
      />
    </div>
  );
}
