import type { ReactNode } from "react";

/**
 * A section label in the sidebar. Headers appear only once an account makes
 * "Cloud" true; before that the sidebar is one unlabeled list.
 */
export function SidebarSectionHeader({
  label,
  children,
}: {
  label: string;
  children?: ReactNode;
}) {
  return (
    <div
      data-sidebar-chrome
      data-sidebar-section-header={label}
      className="flex items-center justify-between px-4 pb-1 pt-3"
    >
      <span className="text-[10px] font-medium uppercase text-ring" style={{ letterSpacing: "1.2px" }}>
        {label}
      </span>
      {children}
    </div>
  );
}

/** A quiet one-line row for an empty section or a root that needs attention. */
export function SidebarMutedRow({
  children,
  title,
  onClick,
}: {
  children: ReactNode;
  title?: string;
  onClick?: () => void;
}) {
  const className = "flex w-full items-center gap-2 px-4 py-1 text-left text-xs leading-5 text-ring";
  if (onClick) {
    return (
      <button type="button" className={`${className} cursor-pointer hover:text-sidebar-foreground`} title={title} onClick={onClick}>
        {children}
      </button>
    );
  }
  return <div className={className} title={title}>{children}</div>;
}
