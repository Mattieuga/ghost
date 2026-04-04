import type { EditorView } from "@tiptap/pm/view";

// Must match .ghost-editor padding in editor-styles.css
const EDITOR_PADDING_LEFT = 56;
const EDITOR_PADDING_RIGHT = 45;

/** Find the best insert position for a block-level drop at clientY */
export function getBlockDropPos(view: EditorView, clientY: number): number {
  const { doc } = view.state;
  let bestPos = 0;
  let bestDist = Infinity;

  doc.forEach((node, offset) => {
    const domNode = view.nodeDOM(offset);
    if (!(domNode instanceof HTMLElement)) return;

    const rect = domNode.getBoundingClientRect();

    const topDist = Math.abs(clientY - rect.top);
    if (topDist < bestDist) {
      bestDist = topDist;
      bestPos = offset;
    }

    const bottomDist = Math.abs(clientY - rect.bottom);
    if (bottomDist < bestDist) {
      bestDist = bottomDist;
      bestPos = offset + node.nodeSize;
    }
  });

  return bestPos;
}

/** Position a fixed drop indicator line at the insert position */
export function updateDropIndicator(view: EditorView, indicator: HTMLElement, insertPos: number) {
  const editorRect = view.dom.getBoundingClientRect();
  let targetY: number;

  if (insertPos >= view.state.doc.content.size) {
    const lastChild = view.dom.lastElementChild as HTMLElement;
    targetY = lastChild ? lastChild.getBoundingClientRect().bottom : editorRect.top;
  } else {
    const domNode = view.nodeDOM(insertPos);
    if (domNode instanceof HTMLElement) {
      targetY = domNode.getBoundingClientRect().top;
    } else {
      return;
    }
  }

  const contentLeft = editorRect.left + EDITOR_PADDING_LEFT;
  const contentRight = editorRect.right - EDITOR_PADDING_RIGHT;

  indicator.style.top = `${targetY}px`;
  indicator.style.left = `${contentLeft}px`;
  indicator.style.width = `${contentRight - contentLeft}px`;
  indicator.style.display = "block";
}

/** Start a pointer-based block drag. Returns cleanup function. */
export function startBlockDrag(
  view: EditorView,
  nodePos: number,
  nodeSize: number,
  e: PointerEvent,
  ghostLabel: string,
) {
  const ghost = document.createElement("div");
  ghost.className = "block-drag-ghost";
  ghost.textContent = ghostLabel;
  ghost.style.left = `${e.clientX + 8}px`;
  ghost.style.top = `${e.clientY - 12}px`;
  document.body.appendChild(ghost);

  const indicator = document.createElement("div");
  indicator.className = "block-drop-indicator";
  document.body.appendChild(indicator);

  document.body.style.cursor = "grabbing";
  document.body.style.userSelect = "none";

  const onMove = (ev: PointerEvent) => {
    ev.preventDefault();
    ghost.style.left = `${ev.clientX + 8}px`;
    ghost.style.top = `${ev.clientY - 12}px`;
    const insertPos = getBlockDropPos(view, ev.clientY);
    updateDropIndicator(view, indicator, insertPos);
  };

  const onUp = (ev: PointerEvent) => {
    ghost.remove();
    indicator.remove();
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);

    const node = view.state.doc.nodeAt(nodePos);
    if (!node) return;

    const insertPos = getBlockDropPos(view, ev.clientY);

    // Don't drop onto itself
    if (insertPos >= nodePos && insertPos <= nodePos + nodeSize) return;

    const tr = view.state.tr;

    if (insertPos > nodePos) {
      tr.insert(insertPos, node);
      tr.delete(nodePos, nodePos + nodeSize);
    } else {
      tr.delete(nodePos, nodePos + nodeSize);
      tr.insert(insertPos, node);
    }

    view.dispatch(tr);
  };

  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", onUp);
}
