import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, EditorView } from "@tiptap/pm/view";
import { getBlockDropPos, updateDropIndicator } from "./block-drag";

const pluginKey = new PluginKey("collapsibleHeadings");

const chevronSvg = `<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M3.5 2L7 5L3.5 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// --- Pointer-based drag state ---
let dragState: {
  view: EditorView;
  headingPos: number;
  ghost: HTMLElement;
  indicator: HTMLElement;
} | null = null;

function onPointerMove(e: PointerEvent) {
  if (!dragState) return;
  e.preventDefault();

  dragState.ghost.style.left = `${e.clientX + 8}px`;
  dragState.ghost.style.top = `${e.clientY - 12}px`;

  const insertPos = getBlockDropPos(dragState.view, e.clientY);
  updateDropIndicator(dragState.view, dragState.indicator, insertPos);
}

/**
 * Get the end position of a heading's section:
 * the heading node + all content until the next heading of same or higher level.
 */
function getSectionEnd(view: EditorView, headingPos: number): number {
  const doc = view.state.doc;
  const headingNode = doc.nodeAt(headingPos);
  if (!headingNode || headingNode.type.name !== "heading") {
    return headingPos + (headingNode?.nodeSize ?? 0);
  }

  const level = headingNode.attrs.level;
  let endPos = doc.content.size;

  doc.forEach((node, offset) => {
    if (offset > headingPos && node.type.name === "heading" && node.attrs.level <= level && offset < endPos) {
      endPos = offset;
    }
  });

  return endPos;
}

function onPointerUp(e: PointerEvent) {
  if (!dragState) return;

  const { view, headingPos, ghost, indicator } = dragState;
  dragState = null;

  // Clean up
  ghost.remove();
  indicator.remove();
  document.removeEventListener("pointermove", onPointerMove);
  document.removeEventListener("pointerup", onPointerUp);
  document.body.style.cursor = "";
  document.body.style.userSelect = "";

  const node = view.state.doc.nodeAt(headingPos);
  if (!node) return;

  const sectionEnd = getSectionEnd(view, headingPos);

  // Don't drop onto itself
  const insertPos = getBlockDropPos(view, e.clientY);
  if (insertPos >= headingPos && insertPos <= sectionEnd) return;

  // Check if this heading was collapsed
  const collapsed = pluginKey.getState(view.state) as Set<number>;
  const wasCollapsed = collapsed.has(headingPos);

  // Collect all nodes in the section
  const sectionSlice = view.state.doc.slice(headingPos, sectionEnd);
  const tr = view.state.tr;

  let newHeadingPos: number;

  if (insertPos > headingPos) {
    // Dropping after: insert first, then delete original
    tr.insert(insertPos, sectionSlice.content);
    tr.delete(headingPos, sectionEnd);
    newHeadingPos = insertPos - (sectionEnd - headingPos);
  } else {
    // Dropping before: delete first, then insert
    tr.delete(headingPos, sectionEnd);
    tr.insert(insertPos, sectionSlice.content);
    newHeadingPos = insertPos;
  }

  // Preserve collapsed state at the new position
  if (wasCollapsed) {
    tr.setMeta(pluginKey, { forceCollapse: newHeadingPos });
  }

  view.dispatch(tr);
}

function startDrag(view: EditorView, headingPos: number, level: number, e: PointerEvent) {
  // Ghost label that follows the cursor
  const ghost = document.createElement("span");
  ghost.className = "block-drag-ghost";
  ghost.textContent = `H${level}`;
  ghost.style.left = `${e.clientX + 8}px`;
  ghost.style.top = `${e.clientY - 12}px`;
  document.body.appendChild(ghost);

  // Drop indicator line
  const indicator = document.createElement("div");
  indicator.className = "block-drop-indicator";
  document.body.appendChild(indicator);

  dragState = { view, headingPos, ghost, indicator };

  document.body.style.cursor = "grabbing";
  document.body.style.userSelect = "none";
  document.addEventListener("pointermove", onPointerMove);
  document.addEventListener("pointerup", onPointerUp);
}

export const CollapsibleHeadings = Extension.create({
  name: "collapsibleHeadings",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: pluginKey,
        state: {
          init(): Set<number> {
            return new Set();
          },
          apply(tr, collapsed: Set<number>): Set<number> {
            if (tr.docChanged) {
              const mapped = new Set<number>();
              for (const pos of collapsed) {
                const newPos = tr.mapping.map(pos);
                const node = tr.doc.nodeAt(newPos);
                if (node?.type.name === "heading") {
                  mapped.add(newPos);
                }
              }
              collapsed = mapped;
            }

            const meta = tr.getMeta(pluginKey);
            if (meta?.forceCollapse !== undefined) {
              const next = new Set(collapsed);
              next.add(meta.forceCollapse);
              return next;
            }
            if (meta?.togglePos !== undefined) {
              const next = new Set(collapsed);
              if (next.has(meta.togglePos)) {
                next.delete(meta.togglePos);
              } else {
                next.add(meta.togglePos);
              }
              return next;
            }

            return collapsed;
          },
        },
        props: {
          decorations(state) {
            const collapsed = pluginKey.getState(state) as Set<number>;
            const { doc } = state;
            const decorations: Decoration[] = [];

            const headings: Array<{ pos: number; level: number; nodeSize: number }> = [];
            doc.forEach((node, pos) => {
              if (node.type.name === "heading") {
                headings.push({ pos, level: node.attrs.level, nodeSize: node.nodeSize });
              }
            });

            for (const h of headings) {
              const isCollapsed = collapsed.has(h.pos);

              // Chevron widget
              decorations.push(
                Decoration.widget(
                  h.pos + 1,
                  (view) => {
                    const btn = document.createElement("button");
                    btn.className = `collapse-chevron${isCollapsed ? " is-collapsed" : ""}`;
                    btn.setAttribute("contenteditable", "false");
                    btn.setAttribute("tabindex", "-1");
                    btn.innerHTML = chevronSvg;
                    btn.addEventListener("mousedown", (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      view.dispatch(
                        view.state.tr.setMeta(pluginKey, { togglePos: h.pos })
                      );
                    });
                    return btn;
                  },
                  { side: -1, key: `chevron-${h.pos}-${isCollapsed}` }
                )
              );

              // H# drag label widget — uses pointer events (not HTML5 DnD)
              decorations.push(
                Decoration.widget(
                  h.pos + 1,
                  (view) => {
                    const label = document.createElement("span");
                    label.className = "heading-drag-label";
                    label.textContent = `H${h.level}`;
                    label.setAttribute("contenteditable", "false");

                    label.addEventListener("pointerdown", (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      startDrag(view, h.pos, h.level, e);
                    });

                    return label;
                  },
                  { side: -1, key: `hlabel-${h.pos}-${h.level}` }
                )
              );

              // "..." pill when collapsed
              if (isCollapsed) {
                decorations.push(
                  Decoration.widget(
                    h.pos + h.nodeSize - 1,
                    (view) => {
                      const pill = document.createElement("span");
                      pill.className = "collapsed-pill";
                      pill.setAttribute("contenteditable", "false");
                      pill.innerHTML = `<span class="collapsed-pill-dot"></span><span class="collapsed-pill-dot"></span><span class="collapsed-pill-dot"></span>`;
                      pill.addEventListener("mousedown", (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        view.dispatch(
                          view.state.tr.setMeta(pluginKey, { togglePos: h.pos })
                        );
                      });
                      return pill;
                    },
                    { side: 1, key: `pill-${h.pos}` }
                  )
                );
              }

              // Hide content under collapsed heading
              if (isCollapsed) {
                const afterHeading = h.pos + h.nodeSize;
                let endPos = doc.content.size;
                for (const other of headings) {
                  if (other.pos > h.pos && other.level <= h.level && other.pos < endPos) {
                    endPos = other.pos;
                  }
                }
                doc.forEach((node, offset) => {
                  if (offset >= afterHeading && offset < endPos) {
                    decorations.push(
                      Decoration.node(offset, offset + node.nodeSize, {
                        class: "collapsed-content",
                      })
                    );
                  }
                });
              }
            }

            return DecorationSet.create(doc, decorations);
          },
        },
      }),
    ];
  },
});
