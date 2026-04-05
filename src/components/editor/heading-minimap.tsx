import { useEffect, useRef, useState, useCallback } from "react";
import type { Editor } from "@tiptap/react";

interface HeadingEntry {
  level: number;
  text: string;
  pos: number;
}

const MAX_WIDTH = 28;
const MIN_WIDTH = 8;
const LEVEL_STEP = (MAX_WIDTH - MIN_WIDTH) / 5;

function widthForLevel(level: number): number {
  const clamped = Math.min(level, 6);
  return MAX_WIDTH - (clamped - 1) * LEVEL_STEP;
}

function domForHeading(editor: Editor, pos: number): HTMLElement | null {
  try {
    // pos is the start of the heading node; pos+1 is inside it
    const domAtPos = editor.view.domAtPos(pos + 1);
    const node = domAtPos.node;
    const el = (node instanceof HTMLElement ? node : node.parentElement) as HTMLElement | null;
    if (!el) return null;
    return (el.closest("h1,h2,h3,h4,h5,h6") ?? el) as HTMLElement;
  } catch {
    return null;
  }
}

export function HeadingMinimap({ editor, scrollContainer }: { editor: Editor; scrollContainer: HTMLElement }) {
  const [headings, setHeadings] = useState<HeadingEntry[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [hovered, setHovered] = useState(false);
  const [hoveredIndex, setHoveredIndex] = useState(-1);
  const rafRef = useRef(0);
  const linesRef = useRef<(HTMLDivElement | null)[]>([]);

  const extractHeadings = useCallback(() => {
    const entries: HeadingEntry[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "heading") {
        entries.push({
          level: node.attrs.level ?? 1,
          text: node.textContent,
          pos,
        });
      }
    });
    setHeadings(entries);
  }, [editor]);

  const updateActiveHeading = useCallback(() => {
    if (headings.length === 0) return;
    const containerRect = scrollContainer.getBoundingClientRect();
    const threshold = containerRect.top + 70;
    let bestIdx = 0;

    for (let i = 0; i < headings.length; i++) {
      const el = domForHeading(editor, headings[i].pos);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (rect.top <= threshold) {
        bestIdx = i;
      } else {
        break;
      }
    }
    setActiveIndex(bestIdx);
  }, [editor, headings, scrollContainer]);

  useEffect(() => {
    extractHeadings();
    const handler = () => extractHeadings();
    editor.on("update", handler);
    return () => { editor.off("update", handler); };
  }, [editor, extractHeadings]);

  useEffect(() => {
    updateActiveHeading();
    const onScroll = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(updateActiveHeading);
    };
    scrollContainer.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scrollContainer.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(rafRef.current);
    };
  }, [updateActiveHeading, scrollContainer]);

  const scrollToHeading = useCallback((entry: HeadingEntry) => {
    const el = domForHeading(editor, entry.pos);
    if (!el) return;
    const elTop = el.getBoundingClientRect().top;
    const containerTop = scrollContainer.getBoundingClientRect().top;
    const offset = elTop - containerTop - 56; // clear the 48px nav bar + a little breathing room
    scrollContainer.scrollBy({ top: offset, behavior: "smooth" });
  }, [editor, scrollContainer]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const refs = linesRef.current;
    if (refs.length === 0) return;
    let closest = 0;
    let closestDist = Infinity;
    for (let i = 0; i < refs.length; i++) {
      const el = refs[i];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      const centerY = rect.top + rect.height / 2;
      const dist = Math.abs(e.clientY - centerY);
      if (dist < closestDist) {
        closestDist = dist;
        closest = i;
      }
    }
    setHoveredIndex(closest);
  }, []);

  if (headings.length === 0) return null;

  linesRef.current.length = headings.length;

  return (
    <div
      className="absolute right-0 top-0 bottom-0 flex flex-col items-end z-[5]"
      style={{ width: 45, paddingTop: 60, paddingBottom: 24, paddingRight: 10, cursor: "pointer" }}
      onMouseEnter={() => setHovered(true)}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => { setHovered(false); setHoveredIndex(-1); }}
      onClick={() => { if (hoveredIndex >= 0 && hoveredIndex < headings.length) scrollToHeading(headings[hoveredIndex]); }}
    >
      <div className="flex flex-col gap-[14px] items-end relative">
        {headings.map((h, i) => {
          const isActive = i === activeIndex;
          const isItemHovered = i === hoveredIndex;
          const baseWidth = widthForLevel(h.level);
          const width = isItemHovered ? baseWidth + 4 : baseWidth;
          const height = isItemHovered ? 1.5 : 1;
          const opacity = hovered
            ? (isItemHovered ? 1 : isActive ? 0.55 : 0.4)
            : (isActive ? 0.3 : 0.15);

          return (
            <div
              ref={el => { linesRef.current[i] = el; }}
              key={`${h.pos}-${h.level}`}
              className="relative flex items-center justify-end"
            >
              {/* Tooltip */}
              {hovered && isItemHovered && (
                <div
                  className="absolute right-full mr-2 px-2.5 py-1.5 rounded-md text-xs whitespace-nowrap pointer-events-none select-none"
                  style={{
                    background: "var(--popover)",
                    color: "var(--popover-foreground)",
                    border: "1px solid var(--border)",
                    maxWidth: 220,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    animation: "minimap-tooltip-in 150ms ease-out",
                  }}
                >
                  {h.text}
                </div>
              )}

              {/* Line */}
              <div
                style={{
                  width,
                  height,
                  borderRadius: 1,
                  backgroundColor: isActive ? "var(--ghost-amber)" : "var(--foreground)",
                  opacity,
                  transition: "all 200ms ease",
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
