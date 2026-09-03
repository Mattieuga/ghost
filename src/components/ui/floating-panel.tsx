import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useCompactMode } from "@/hooks/use-compact-mode";

/**
 * The floating panel Settings uses: a dimmed backdrop, a card anchored near
 * the top so its height can change without moving, a bordered header with
 * the title and a close button, and a scrolling body. Escape and a click on
 * the backdrop close it. Other sheets use the same shell so they read as
 * one family.
 */
export function FloatingPanel({
  title,
  ariaLabel,
  description,
  onClose,
  headerExtra,
  footer,
  width = 520,
  children,
  ...rest
}: {
  title: ReactNode;
  /** Required when the title is not plain text. */
  ariaLabel?: string;
  description?: ReactNode;
  onClose: () => void;
  /** Rendered below the title inside the header, for a tab bar. */
  headerExtra?: ReactNode;
  footer?: ReactNode;
  width?: number;
  children: ReactNode;
} & Record<`data-${string}`, string | boolean | undefined>) {
  const compact = useCompactMode();

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return createPortal(
    <>
      <div
        data-native-view-overlay
        className="fixed inset-0 z-50 bg-black/60 animate-in fade-in-0 duration-150"
        onClick={onClose}
      />
      <div
        className="fixed left-1/2 z-50 -translate-x-1/2 animate-in fade-in-0 zoom-in-95 duration-150"
        style={{ top: "min(12%, calc(100vh - 520px))", width: compact ? "calc(100vw - 1.5rem)" : width, maxWidth: "calc(100vw - 1rem)" }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={ariaLabel ?? (typeof title === "string" ? title : undefined)}
          className="rounded-xl border border-border bg-popover shadow-2xl overflow-hidden flex flex-col"
          style={{ maxHeight: "min(72vh, calc(100vh - 2rem))" }}
          {...rest}
        >
          <div className={`px-5 pt-5 border-b border-border shrink-0 ${headerExtra ? "pb-3" : "pb-4"}`}>
            <div className={`flex items-start justify-between gap-4 ${headerExtra ? "mb-4" : ""}`}>
              <div className="min-w-0">
                <h2 className="text-base font-semibold">{title}</h2>
                {description ? <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</p> : null}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
              >
                <X className="size-4" />
              </button>
            </div>
            {headerExtra}
          </div>
          <div className="overflow-y-auto p-5">{children}</div>
          {footer ? <div className="flex justify-end gap-2 border-t border-border px-5 py-4 shrink-0">{footer}</div> : null}
        </div>
      </div>
    </>,
    document.body,
  );
}
