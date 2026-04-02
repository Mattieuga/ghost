import { cn } from "@/lib/utils";
import type { ThemeColors } from "@/lib/theme-engine";
import { deriveTheme } from "@/lib/theme-engine";

interface ThemeCardProps {
  label: string;
  colors: ThemeColors;
  isActive: boolean;
  onClick: () => void;
  onDelete?: () => void;
}

export function ThemeCard({ label, colors, isActive, onClick, onDelete }: ThemeCardProps) {
  const derived = deriveTheme(colors);

  return (
    <button
      onClick={onClick}
      className={cn(
        "relative w-full rounded-xl border-2 p-2 text-left transition-all cursor-pointer",
        isActive
          ? "border-ghost-amber"
          : "border-border hover:border-ring"
      )}
    >
      {/* Mini editor preview */}
      <div
        className="rounded-lg overflow-hidden flex"
        style={{
          border: `1px solid ${derived["--border"]}`,
          height: 100,
        }}
      >
        {/* Sidebar preview */}
        <div
          className="w-[40px] shrink-0 p-1.5 flex flex-col gap-1"
          style={{ background: colors.sidebarBg, borderRight: `1px solid ${derived["--sidebar-border"]}` }}
        >
          <div className="h-1 rounded-full w-5" style={{ background: derived["--sidebar-primary"] }} />
          <div className="h-0.5 rounded-full w-6 ml-1" style={{ background: derived["--sidebar-foreground"], opacity: 0.5 }} />
          <div className="h-0.5 rounded-full w-4 ml-1" style={{ background: colors.accent }} />
          <div className="h-0.5 rounded-full w-5 ml-1" style={{ background: derived["--sidebar-foreground"], opacity: 0.5 }} />
        </div>
        {/* Editor preview */}
        <div className="flex-1 p-2 overflow-hidden" style={{ background: colors.editorBg }}>
          <div style={{ color: colors.heading, fontWeight: 700, fontSize: 10, marginBottom: 3 }}>
            The Great Gatsby
          </div>
          <div style={{ color: colors.text, fontSize: 8, lineHeight: 1.5 }}>
            In my younger years, my father gave me{" "}
            <span style={{ color: colors.accent, textDecoration: "underline" }}>advice</span>{" "}
            that I've been turning over in my mind.
          </div>
        </div>
      </div>

      {/* Label row */}
      <div className="mt-1.5 flex items-center justify-between px-0.5">
        <span className="text-xs font-medium truncate">{label}</span>
        <div className="flex items-center gap-1.5">
          {isActive && <span className="size-2 rounded-full bg-ghost-amber shrink-0" />}
          {onDelete && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="text-muted-foreground hover:text-destructive text-xs cursor-pointer"
              title="Delete theme"
            >
              ✕
            </button>
          )}
        </div>
      </div>
    </button>
  );
}
