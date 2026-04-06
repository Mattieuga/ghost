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
const LINE_GAP = 14;
const PAD_TOP = 80;
const PAD_BOTTOM = 24;

function widthForLevel(level: number): number {
  const clamped = Math.min(level, 6);
  return MAX_WIDTH - (clamped - 1) * LEVEL_STEP;
}

function domForHeading(editor: Editor, pos: number): HTMLElement | null {
  try {
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
  const [tooltipY, setTooltipY] = useState(0);
  const rafRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const linesRef = useRef<(HTMLDivElement | null)[]>([]);
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

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
    const handler = () => {
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(extractHeadings, 300);
    };
    editor.on("update", handler);
    return () => {
      editor.off("update", handler);
      clearTimeout(debounceRef.current);
    };
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
    const offset = elTop - containerTop - 56;
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
    // Track the hovered line's Y relative to the outer container for tooltip positioning
    const lineEl = refs[closest];
    const outer = outerRef.current;
    if (lineEl && outer) {
      const lineRect = lineEl.getBoundingClientRect();
      const outerRect = outer.getBoundingClientRect();
      setTooltipY(lineRect.top - outerRect.top + lineRect.height / 2);
    }
  }, []);

  useEffect(() => {
    linesRef.current.length = headings.length;
  }, [headings.length]);

  if (headings.length === 0) return null;

  // Compute translateY to keep the active line centered when minimap overflows
  const innerHeight = innerRef.current?.scrollHeight ?? 0;
  const outerHeight = outerRef.current?.clientHeight ?? 0;
  const viewportHeight = outerHeight - PAD_TOP - PAD_BOTTOM;
  const overflows = innerHeight > viewportHeight && viewportHeight > 0;

  let translateY = 0;
  if (overflows) {
    const activeLineY = activeIndex * LINE_GAP;
    const targetOffset = activeLineY - viewportHeight / 2;
    const maxOffset = innerHeight - viewportHeight;
    translateY = -Math.max(0, Math.min(targetOffset, maxOffset));
  }

  const hoveredHeading = hovered && hoveredIndex >= 0 ? headings[hoveredIndex] : null;

  return (
    <div
      ref={outerRef}
      className="absolute right-0 top-0 bottom-0 z-[5]"
      style={{ width: 45, cursor: "pointer" }}
      onMouseEnter={() => setHovered(true)}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => { setHovered(false); setHoveredIndex(-1); }}
      onClick={() => { if (hoveredIndex >= 0 && hoveredIndex < headings.length) scrollToHeading(headings[hoveredIndex]); }}
    >
      {/* Tooltip — rendered outside the clipped area */}
      {hoveredHeading && (
        <div
          className="absolute right-full mr-1 px-2.5 py-1.5 rounded-md text-xs whitespace-nowrap pointer-events-none select-none"
          style={{
            top: tooltipY,
            transform: "translateY(-50%)",
            background: "var(--popover)",
            color: "var(--popover-foreground)",
            border: "1px solid var(--border)",
            maxWidth: 220,
            overflow: "hidden",
            textOverflow: "ellipsis",
            animation: "minimap-tooltip-in 150ms ease-out",
          }}
        >
          {hoveredHeading.text}
        </div>
      )}

      {/* Lines container — clipped for overflow scrolling */}
      <div
        className="absolute top-0 bottom-0 right-0 flex flex-col items-end"
        style={{
          width: 45,
          paddingTop: PAD_TOP,
          paddingBottom: PAD_BOTTOM,
          paddingRight: 10,
          overflow: "hidden",
        }}
      >
        <div
          ref={innerRef}
          className="flex flex-col items-end relative"
          style={{
            gap: LINE_GAP,
            transform: `translateY(${translateY}px)`,
            transition: "transform 400ms ease-out",
          }}
        >
          {headings.map((h, i) => {
            const isActive = i === activeIndex;
            const dist = hoveredIndex >= 0 ? Math.abs(i - hoveredIndex) : Infinity;
            const baseWidth = widthForLevel(h.level);

            const proximity = hovered && dist <= 3 ? 1 - dist / 3 : 0;
            const width = baseWidth + proximity * 4;
            const height = 1 + proximity * 0.5;
            const baseOpacity = isActive ? 0.7 : 0.4;
            const opacity = hovered
              ? baseOpacity + proximity * (1 - baseOpacity)
              : (isActive ? 0.45 : 0.15);

            return (
              <div
                ref={el => { linesRef.current[i] = el; }}
                key={i}
                className="flex items-center justify-end"
              >
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
    </div>
  );
}
