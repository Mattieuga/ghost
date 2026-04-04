import { useEffect, useCallback, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";

interface TableControlsProps {
  editor: Editor;
}

interface MenuState {
  x: number;
  y: number;
}

export function TableControls({ editor }: TableControlsProps) {
  const [addRowBtn, setAddRowBtn] = useState<{ left: number; top: number; width: number } | null>(null);
  const [addColBtn, setAddColBtn] = useState<{ left: number; top: number; height: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<MenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const addRowHovered = useRef(false);
  const addColHovered = useRef(false);
  const hideTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTableEl = useRef<HTMLElement | null>(null);

  // Focus a cell inside the given table so table commands work
  const focusTable = useCallback((table: HTMLElement) => {
    const lastCell = table.querySelector("td:last-child, th:last-child");
    if (lastCell) {
      const pos = editor.view.posAtDOM(lastCell, 0);
      editor.chain().focus().setTextSelection(pos).run();
    }
  }, [editor]);

  // Close context menu on outside click or Escape
  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && e.target instanceof Node && !menuRef.current.contains(e.target)) {
        setContextMenu(null);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [contextMenu]);

  // Track which table has focus and add visual indicator
  const focusedTableRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const updateFocus = () => {
      // Remove from previous
      if (focusedTableRef.current) {
        focusedTableRef.current.classList.remove("table-focused");
        focusedTableRef.current = null;
      }
      // Add to current
      try {
        const { $from } = editor.state.selection;
        const domAtPos = editor.view.domAtPos($from.pos);
        const table = (domAtPos.node as HTMLElement).closest?.("table") ??
                      (domAtPos.node.parentElement)?.closest?.("table");
        if (table) {
          table.classList.add("table-focused");
          focusedTableRef.current = table as HTMLElement;
        }
      } catch { /* pos may be invalid during transitions */ }
    };
    editor.on("selectionUpdate", updateFocus);
    return () => {
      editor.off("selectionUpdate", updateFocus);
      if (focusedTableRef.current) focusedTableRef.current.classList.remove("table-focused");
    };
  }, [editor]);

  // Delayed hide — gives time to move mouse from table edge to the "+" button
  const scheduleHideRow = useCallback(() => {
    hideTimeout.current = setTimeout(() => {
      if (!addRowHovered.current) setAddRowBtn(null);
    }, 200);
  }, []);
  const scheduleHideCol = useCallback(() => {
    hideTimeout.current = setTimeout(() => {
      if (!addColHovered.current) setAddColBtn(null);
    }, 200);
  }, []);

  // Handle mousemove over editor to show "+" buttons
  useEffect(() => {
    const editorEl = editor.view.dom;

    const handleMouseMove = (e: MouseEvent) => {
      const table = (e.target as HTMLElement).closest("table");
      if (!table) {
        scheduleHideRow();
        scheduleHideCol();
        return;
      }

      lastTableEl.current = table as HTMLElement;
      const tableRect = table.getBoundingClientRect();
      const mouseX = e.clientX;
      const mouseY = e.clientY;

      // "+" button at the bottom edge to add a row
      const nearBottom = mouseY > tableRect.bottom - 30 && mouseY < tableRect.bottom + 40;
      if (nearBottom) {
        if (hideTimeout.current) clearTimeout(hideTimeout.current);
        const wrapper = table.closest(".tableWrapper");
        const wrapperRect = wrapper ? wrapper.getBoundingClientRect() : tableRect;
        const btnLeft = Math.max(tableRect.left, wrapperRect.left);
        const btnRight = Math.min(tableRect.right, wrapperRect.right);
        setAddRowBtn({ left: btnLeft, top: tableRect.bottom + 4, width: btnRight - btnLeft });
      } else if (!addRowHovered.current) {
        setAddRowBtn(null);
      }

      // "+" button at the right edge to add a column
      const nearRight = mouseX > tableRect.right - 30 && mouseX < tableRect.right + 40;
      if (nearRight) {
        if (hideTimeout.current) clearTimeout(hideTimeout.current);
        const wrapper = table.closest(".tableWrapper");
        const wrapperRect = wrapper ? wrapper.getBoundingClientRect() : tableRect;
        const colBtnLeft = Math.min(tableRect.right, wrapperRect.right);
        setAddColBtn({ left: colBtnLeft + 4, top: tableRect.top, height: tableRect.height });
      } else if (!addColHovered.current) {
        setAddColBtn(null);
      }
    };

    // Hide all controls on scroll (positions become stale)
    const scrollParent = editorEl.closest("main");
    const handleScroll = () => {
      setAddRowBtn(null);
      setAddColBtn(null);
      lastTableEl.current = null;
    };

    editorEl.addEventListener("mousemove", handleMouseMove);
    scrollParent?.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      editorEl.removeEventListener("mousemove", handleMouseMove);
      scrollParent?.removeEventListener("scroll", handleScroll);
    };
  }, [editor, scheduleHideRow, scheduleHideCol]);

  // Right-click context menu on tables
  useEffect(() => {
    const editorEl = editor.view.dom;
    const handleContextMenu = (e: MouseEvent) => {
      const table = (e.target as HTMLElement).closest("table");
      if (!table) return;
      e.preventDefault();

      // Ensure cursor is in this table so commands know which row/column to target
      if (!editor.isActive("table")) {
        focusTable(table as HTMLElement);
      }

      // Calculate position, flip if near edges
      let x = e.clientX;
      let y = e.clientY;
      const menuWidth = 210;
      const menuHeight = 380;
      if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 8;
      if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 8;
      if (x < 8) x = 8;
      if (y < 8) y = 8;

      setContextMenu({ x, y });
    };
    editorEl.addEventListener("contextmenu", handleContextMenu);
    return () => editorEl.removeEventListener("contextmenu", handleContextMenu);
  }, [editor]);

  const menuAction = useCallback((action: () => void) => {
    action();
    setContextMenu(null);
  }, []);

  return (
    <>
      {/* Add row button — bottom edge */}
      {addRowBtn && (
        <button
          className="table-add-btn table-add-row"
          style={{ left: addRowBtn.left, top: addRowBtn.top, width: addRowBtn.width }}
          onMouseEnter={() => { addRowHovered.current = true; }}
          onMouseLeave={() => { addRowHovered.current = false; setAddRowBtn(null); }}
          onMouseDown={(e) => {
            e.preventDefault();
            if (lastTableEl.current) focusTable(lastTableEl.current);
            editor.chain().focus().addRowAfter().run();
            setAddRowBtn(null);
          }}
        >
          <span className="table-add-icon">+</span>
        </button>
      )}

      {/* Add column button — right edge */}
      {addColBtn && (
        <button
          className="table-add-btn table-add-col"
          style={{ left: addColBtn.left, top: addColBtn.top, height: addColBtn.height }}
          onMouseEnter={() => { addColHovered.current = true; }}
          onMouseLeave={() => { addColHovered.current = false; setAddColBtn(null); }}
          onMouseDown={(e) => {
            e.preventDefault();
            if (lastTableEl.current) focusTable(lastTableEl.current);
            editor.chain().focus().addColumnAfter().run();
            setAddColBtn(null);
          }}
        >
          <span className="table-add-icon">+</span>
        </button>
      )}

      {/* Context menu */}
      {contextMenu && (
        <div
          ref={menuRef}
          className="table-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button className="table-menu-item" onMouseDown={() => menuAction(() => editor.chain().focus().addRowBefore().run())}>
            Add Row Above
          </button>
          <button className="table-menu-item" onMouseDown={() => menuAction(() => editor.chain().focus().addRowAfter().run())}>
            Add Row Below
          </button>
          <button className="table-menu-item table-menu-danger" onMouseDown={() => menuAction(() => editor.chain().focus().deleteRow().run())}>
            Delete Row
          </button>

          <div className="table-menu-separator" />

          <button className="table-menu-item" onMouseDown={() => menuAction(() => editor.chain().focus().addColumnBefore().run())}>
            Add Column Before
          </button>
          <button className="table-menu-item" onMouseDown={() => menuAction(() => editor.chain().focus().addColumnAfter().run())}>
            Add Column After
          </button>
          <button className="table-menu-item table-menu-danger" onMouseDown={() => menuAction(() => editor.chain().focus().deleteColumn().run())}>
            Delete Column
          </button>

          <div className="table-menu-separator" />

          <button className="table-menu-item" onMouseDown={() => menuAction(() => editor.chain().focus().toggleHeaderRow().run())}>
            Toggle Header Row
          </button>
          <button className="table-menu-item" onMouseDown={() => menuAction(() => editor.chain().focus().toggleHeaderColumn().run())}>
            Toggle Header Column
          </button>
          <button className="table-menu-item" onMouseDown={() => menuAction(() => editor.chain().focus().toggleHeaderCell().run())}>
            Toggle Header Cell
          </button>

          <div className="table-menu-separator" />

          <button className="table-menu-item table-menu-danger" onMouseDown={() => menuAction(() => editor.chain().focus().deleteTable().run())}>
            Delete Table
          </button>
        </div>
      )}
    </>
  );
}
