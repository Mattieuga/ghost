import type {
  ButtonHTMLAttributes,
  ChangeEventHandler,
  FocusEventHandler,
  HTMLAttributes,
  KeyboardEventHandler,
  ReactNode,
  Ref,
} from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

export const SIDEBAR_INDENT_BASE = 16;
export const SIDEBAR_INDENT_STEP = 14;
export const SIDEBAR_FILE_EXTRA_INDENT = 12;

export interface SidebarTreeActions {
  open?: () => void;
  openNewWindow?: () => void;
  openNewProject?: () => void;
  newFile?: () => void;
  newFolder?: () => void;
  copy?: () => void;
  copyTextAs?: (format: "plain" | "markdown" | "rich") => void;
  reveal?: () => void;
  copyPath?: () => void;
  duplicate?: () => void;
  rename?: () => void;
  trash?: () => void;
  closeProject?: () => void;
  toggle?: () => void;
}

function MenuSeparator({ after }: { after: ReactNode }) {
  return after ? <ContextMenuSeparator /> : null;
}

export function SidebarTreeContextMenu({
  kind,
  expanded = false,
  actions,
}: {
  kind: "file" | "folder";
  expanded?: boolean;
  actions: SidebarTreeActions;
}) {
  const openItems = kind === "file" ? (
    <>
      {actions.open ? <ContextMenuItem onSelect={actions.open}>Open File</ContextMenuItem> : null}
      {actions.openNewWindow ? (
        <ContextMenuItem onSelect={actions.openNewWindow}>Open File in New Window</ContextMenuItem>
      ) : null}
    </>
  ) : (
    actions.toggle ? (
      <ContextMenuItem onSelect={actions.toggle}>{expanded ? "Collapse" : "Expand"}</ContextMenuItem>
    ) : null
  );
  const projectItems = (
    <>
      {actions.closeProject ? <ContextMenuItem onSelect={actions.closeProject}>Close Project</ContextMenuItem> : null}
      {actions.openNewProject ? (
        <ContextMenuItem onSelect={actions.openNewProject}>
          Open New Project
          <ContextMenuShortcut>⌘O</ContextMenuShortcut>
        </ContextMenuItem>
      ) : null}
    </>
  );
  const createItems = actions.newFile || actions.newFolder ? (
    <>
      {actions.newFile ? (
        <ContextMenuItem onSelect={actions.newFile}>
          New File
          <ContextMenuShortcut>⌘N</ContextMenuShortcut>
        </ContextMenuItem>
      ) : null}
      {actions.newFolder ? (
        <ContextMenuItem onSelect={actions.newFolder}>
          New Folder
          <ContextMenuShortcut>⇧⌘N</ContextMenuShortcut>
        </ContextMenuItem>
      ) : null}
    </>
  ) : null;
  const copyItems = actions.copy || actions.copyTextAs ? (
    <>
      {actions.copy ? (
        <ContextMenuItem onSelect={actions.copy}>
          {kind === "file" ? "Copy File" : "Copy Folder"}
          <ContextMenuShortcut>⌘C</ContextMenuShortcut>
        </ContextMenuItem>
      ) : null}
      {kind === "file" && actions.copyTextAs ? (
        <ContextMenuSub>
          <ContextMenuSubTrigger>Copy Text As</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuItem onSelect={() => actions.copyTextAs?.("plain")}>Plain Text</ContextMenuItem>
            <ContextMenuItem onSelect={() => actions.copyTextAs?.("markdown")}>Markdown</ContextMenuItem>
            <ContextMenuItem onSelect={() => actions.copyTextAs?.("rich")}>Rich Text</ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
      ) : null}
    </>
  ) : null;
  const locationItems = actions.reveal || actions.copyPath ? (
    <>
      {actions.reveal ? <ContextMenuItem onSelect={actions.reveal}>Reveal in Finder</ContextMenuItem> : null}
      {actions.copyPath ? <ContextMenuItem onSelect={actions.copyPath}>Copy File Path</ContextMenuItem> : null}
    </>
  ) : null;
  const editItems = actions.duplicate || actions.rename ? (
    <>
      {actions.duplicate ? <ContextMenuItem onSelect={actions.duplicate}>Duplicate</ContextMenuItem> : null}
      {actions.rename ? <ContextMenuItem onSelect={actions.rename}>Rename...</ContextMenuItem> : null}
    </>
  ) : null;
  const trashItem = actions.trash ? (
    <ContextMenuItem onSelect={actions.trash} className="text-destructive">
      {kind === "file" ? "Move to Trash" : "Move Folder to Trash"}
    </ContextMenuItem>
  ) : null;

  return (
    <ContextMenuContent className="w-56" onCloseAutoFocus={(event) => event.preventDefault()}>
      {openItems}
      {projectItems}
      <MenuSeparator after={createItems} />
      {createItems}
      <MenuSeparator after={copyItems} />
      {copyItems}
      <MenuSeparator after={locationItems} />
      {locationItems}
      <MenuSeparator after={editItems} />
      {editItems}
      <MenuSeparator after={trashItem} />
      {trashItem}
    </ContextMenuContent>
  );
}

export function SidebarFileTreeItem({
  label,
  indent,
  active = false,
  focused = false,
  onActivate,
  onDoubleClick,
  menu,
  containerRef,
  containerProps,
}: {
  label: string;
  indent: number;
  active?: boolean;
  focused?: boolean;
  onActivate(): void;
  onDoubleClick?: () => void;
  menu: ReactNode;
  containerRef?: Ref<HTMLDivElement>;
  containerProps?: HTMLAttributes<HTMLDivElement>;
}) {
  return (
    <div ref={containerRef} {...containerProps}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            data-tree-focus-target
            data-file-active={active || undefined}
            className={`relative mx-1.5 rounded-[5px] transition-colors ${
              focused
                ? "ring-1 ring-ghost-amber/80 bg-ghost-amber/[0.07] hover:bg-ghost-amber/[0.10]"
                : active
                  ? "bg-white/[0.06] hover:bg-white/[0.09]"
                  : "data-[state=open]:bg-white/[0.06] hover:bg-sidebar-accent/70"
            }`}
          >
            <button
              data-tree-label
              tabIndex={-1}
              onClick={onActivate}
              onDoubleClick={onDoubleClick}
              className={`w-full cursor-pointer select-none truncate py-1 pr-2 text-left text-[13px] transition-colors ${
                active
                  ? "font-medium text-card-foreground"
                  : "text-sidebar-foreground hover:text-sidebar-primary"
              }`}
              style={{ paddingLeft: `${indent - 6}px` }}
            >
              {label}
            </button>
          </div>
        </ContextMenuTrigger>
        {menu}
      </ContextMenu>
    </div>
  );
}

export function SidebarFolderTreeItem({
  label,
  depth,
  expanded,
  isRoot = false,
  rootId,
  active = false,
  focused = false,
  highlighted = false,
  activeRootCollapsed = false,
  dotColor = "var(--muted-foreground)",
  onActivate,
  menu,
  children,
  containerRef,
  containerProps,
  buttonProps,
}: {
  label: string;
  depth: number;
  expanded: boolean;
  isRoot?: boolean;
  rootId?: string;
  active?: boolean;
  focused?: boolean;
  highlighted?: boolean;
  activeRootCollapsed?: boolean;
  dotColor?: string;
  onActivate(): void;
  menu: ReactNode;
  children?: ReactNode;
  containerRef?: Ref<HTMLDivElement>;
  containerProps?: HTMLAttributes<HTMLDivElement>;
  buttonProps?: ButtonHTMLAttributes<HTMLButtonElement>;
}) {
  const togglePadding = SIDEBAR_INDENT_BASE + depth * SIDEBAR_INDENT_STEP;
  return (
    <div
      ref={containerRef}
      {...containerProps}
      data-root-folder={isRoot ? rootId : undefined}
      className={`rounded-md transition-colors ${highlighted ? "bg-muted/60 ring-1 ring-border" : ""} ${containerProps?.className ?? ""}`}
    >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            {...buttonProps}
            data-tree-focus-target
            tabIndex={-1}
            onClick={onActivate}
            data-folder-active={active || undefined}
            data-root-active-collapsed={activeRootCollapsed || undefined}
            className={`relative flex w-full cursor-pointer select-none items-center gap-2 overflow-hidden rounded-[5px] py-1.5 pr-2 text-left transition-colors hover:text-card-foreground ${
              focused
                ? "ring-1 ring-inset ring-ghost-amber/80 bg-ghost-amber/[0.05] hover:bg-ghost-amber/[0.09]"
                : active
                  ? "bg-white/[0.06] hover:bg-white/[0.09]"
                  : "data-[state=open]:bg-white/[0.06] hover:bg-sidebar-accent/70"
            } ${buttonProps?.className ?? ""}`}
            style={{ paddingLeft: `${togglePadding}px`, ...buttonProps?.style }}
          >
            {isRoot ? (
              <span
                data-root-dot
                className="inline-block size-[7px] shrink-0 rounded-full transition-colors"
                style={{
                  backgroundColor: expanded ? dotColor : "transparent",
                  border: `1.5px solid ${dotColor}`,
                }}
              />
            ) : (
              <span data-tree-label className="text-[16px] leading-none text-muted-foreground">
                {expanded ? "▾" : "▸"}
              </span>
            )}
            <span
              data-tree-label
              className={`truncate text-[13px] font-medium ${
                active || isRoot ? "text-card-foreground" : "text-sidebar-primary"
              }`}
            >
              {label}
            </span>
          </button>
        </ContextMenuTrigger>
        {menu}
      </ContextMenu>
      {expanded ? (
        <div className="relative" role="group">
          <div
            className="absolute bottom-0 top-0 w-[1.5px] rounded-full"
            data-tree-guide={isRoot ? "root" : "sub"}
            style={{
              left: `${togglePadding + (isRoot ? 3 : 7)}px`,
              backgroundColor: "var(--border)",
            }}
          />
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function SidebarTreeRenameItem({
  kind,
  value,
  inputRef,
  error = false,
  onChange,
  onFocus,
  onBlur,
  onKeyDown,
  indent = SIDEBAR_INDENT_BASE + SIDEBAR_INDENT_STEP + SIDEBAR_FILE_EXTRA_INDENT,
  depth = 0,
  expanded = false,
  isRoot = false,
  dotColor = "var(--muted-foreground)",
  children,
}: {
  kind: "file" | "folder";
  value: string;
  inputRef?: Ref<HTMLInputElement>;
  error?: boolean;
  onChange: ChangeEventHandler<HTMLInputElement>;
  onFocus?: FocusEventHandler<HTMLInputElement>;
  onBlur?: FocusEventHandler<HTMLInputElement>;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  indent?: number;
  depth?: number;
  expanded?: boolean;
  isRoot?: boolean;
  dotColor?: string;
  children?: ReactNode;
}) {
  const input = (
    <input
      ref={inputRef}
      value={value}
      onChange={onChange}
      onFocus={onFocus}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      className={`${kind === "file" ? "w-full py-1" : "min-w-0 flex-1 py-0.5 font-medium"} rounded-[4px] border bg-transparent px-2 text-[13px] text-card-foreground caret-ghost-amber outline-none transition-colors ${
        error ? "border-red-500 shake-error" : "border-ring"
      }`}
    />
  );

  if (kind === "file") {
    return (
      <div className="py-0.5 pr-2" style={{ paddingLeft: `${indent}px` }}>
        {input}
      </div>
    );
  }

  const togglePadding = SIDEBAR_INDENT_BASE + depth * SIDEBAR_INDENT_STEP;
  return (
    <div className="rounded-md">
      <div className="flex items-center gap-2 py-1 pr-2" style={{ paddingLeft: `${togglePadding}px` }}>
        {isRoot ? (
          <span
            className="inline-block size-[7px] shrink-0 rounded-full"
            style={{
              backgroundColor: expanded ? dotColor : "transparent",
              border: `1.5px solid ${dotColor}`,
            }}
          />
        ) : (
          <span className="text-[16px] leading-none text-muted-foreground">{expanded ? "▾" : "▸"}</span>
        )}
        {input}
      </div>
      {expanded ? (
        <div className="relative" role="group">
          <div
            className="absolute bottom-0 top-0 w-[1.5px] rounded-full"
            data-tree-guide={isRoot ? "root" : "sub"}
            style={{
              left: `${togglePadding + (isRoot ? 3 : 7)}px`,
              backgroundColor: "var(--border)",
            }}
          />
          {children}
        </div>
      ) : null}
    </div>
  );
}
