import { cn } from "@/lib/utils";

interface ThemePreset {
  id: "light" | "dark" | "system";
  label: string;
  bg: string;
  fg: string;
  mutedFg: string;
  heading: string;
  accent: string;
  border: string;
  card: string;
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "light",
    label: "Light",
    bg: "#ffffff",
    fg: "#0a0a0a",
    mutedFg: "#71717a",
    heading: "#0a0a0a",
    accent: "#f57c00",
    border: "#e4e4e7",
    card: "#f4f4f5",
  },
  {
    id: "dark",
    label: "Dark",
    bg: "#09090b",
    fg: "#e4e4e7",
    mutedFg: "#71717a",
    heading: "#fafafa",
    accent: "#f57c00",
    border: "#27272a",
    card: "#18181b",
  },
  {
    id: "system",
    label: "System",
    bg: "#09090b",
    fg: "#e4e4e7",
    mutedFg: "#71717a",
    heading: "#fafafa",
    accent: "#f57c00",
    border: "#27272a",
    card: "#18181b",
  },
];

interface ThemeCardProps {
  preset: ThemePreset;
  isActive: boolean;
  onClick: () => void;
}

export function ThemeCard({ preset, isActive, onClick }: ThemeCardProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full rounded-xl border-2 p-3 text-left transition-all cursor-pointer",
        isActive
          ? "border-ghost-amber"
          : "border-border hover:border-ring"
      )}
    >
      {/* Mini editor preview */}
      <div
        className="rounded-lg p-4 h-36 overflow-hidden"
        style={{ background: preset.bg, border: `1px solid ${preset.border}` }}
      >
        <div
          style={{ color: preset.heading, fontWeight: 700, fontSize: 14, marginBottom: 8 }}
        >
          Things Hidden Since the Foundation
        </div>
        <div style={{ color: preset.mutedFg, fontSize: 11, lineHeight: 1.6 }}>
          Lorem ipsum{" "}
          <span style={{ color: preset.fg, fontWeight: 700 }}>dolor sit amet</span>,
          consectetur adipiscing elit. Mauris iaculis{" "}
          <span style={{ color: preset.accent }}>semper</span> pharetra.
        </div>
      </div>

      {/* Label row */}
      <div className="mt-3 flex items-center justify-between px-1">
        <span className="text-sm font-medium">{preset.label}</span>
        {isActive && (
          <span className="size-2.5 rounded-full bg-ghost-amber" />
        )}
      </div>
    </button>
  );
}
