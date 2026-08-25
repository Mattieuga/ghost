import { useEffect, useMemo, useRef, useState } from "react";
import { estimateTokenCount } from "tokenx";
import { countWords } from "@/lib/editor-utils";
import type { Settings } from "@/hooks/use-settings";
import {
  EAGER_TEXT_STATS_MAX_BYTES,
  formatSourceSize,
  LIVE_TEXT_STATS_MAX_BYTES,
  type SourceInspection,
} from "@/lib/resource-policy";

type CountMode = Settings["countMode"];

interface TextStatsProps {
  text: string;
  countMode: CountMode;
  onCountModeChange: (mode: CountMode) => void;
  sourceInspection?: SourceInspection | null;
  forceStatic?: boolean;
}

const MODE_LABELS: Record<CountMode, string> = {
  words: "words",
  chars: "characters",
  lines: "lines",
  tokens: "tokens",
};

function countLines(text: string): number {
  let lines = 1;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code === 10) {
      lines += 1;
    } else if (code === 13) {
      lines += 1;
      if (text.charCodeAt(index + 1) === 10) index += 1;
    }
  }
  return lines;
}

function computeStat(text: string, mode: CountMode): number {
  switch (mode) {
    case "words": return countWords(text);
    case "chars": return text.length;
    case "lines": return countLines(text);
    case "tokens": return estimateTokenCount(text);
  }
}

function computeAllStats(text: string): Record<CountMode, number> {
  return {
    words: computeStat(text, "words"),
    chars: computeStat(text, "chars"),
    lines: computeStat(text, "lines"),
    tokens: computeStat(text, "tokens"),
  };
}

function StaticTextStats({ inspection }: { inspection: SourceInspection }) {
  const lineSuffix = inspection.line_count_complete ? "" : "+";
  return (
    <span
      className="ml-3 shrink-0 whitespace-nowrap text-[12px] text-ring"
      title="Original file statistics; live counts are disabled for performance"
    >
      {formatSourceSize(inspection.size_bytes)} · {inspection.line_count.toLocaleString()}{lineSuffix} lines
    </span>
  );
}

function LiveTextStats({
  text,
  countMode,
  onCountModeChange,
  sourceSizeBytes,
}: Omit<TextStatsProps, "sourceInspection" | "forceStatic"> & { sourceSizeBytes: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const eager = sourceSizeBytes <= EAGER_TEXT_STATS_MAX_BYTES;
  const stats = useMemo<Partial<Record<CountMode, number>>>(() => (
    eager ? computeAllStats(text) : { [countMode]: computeStat(text, countMode) }
  ), [countMode, eager, text]);

  useEffect(() => {
    if (!open) return;
    const handle = (event: MouseEvent) => {
      if (ref.current && event.target instanceof Node && !ref.current.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  const display = `${(stats[countMode] ?? 0).toLocaleString()} ${MODE_LABELS[countMode]}`;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="text-[12px] text-ring hover:text-muted-foreground transition-colors cursor-pointer select-none whitespace-nowrap shrink-0 ml-3"
      >
        {display}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 min-w-[180px] rounded-lg border border-border bg-popover p-1 shadow-lg">
          {(Object.keys(MODE_LABELS) as CountMode[]).map((mode) => (
            <button
              key={mode}
              className={`flex w-full items-center justify-between rounded-md px-3 py-1.5 text-xs cursor-pointer transition-colors ${
                countMode === mode
                  ? "text-foreground bg-accent"
                  : "text-popover-foreground hover:bg-accent/50"
              }`}
              onClick={() => { onCountModeChange(mode); setOpen(false); }}
            >
              <span>{MODE_LABELS[mode]}</span>
              {stats[mode] !== undefined && (
                <span className="ml-4 tabular-nums text-muted-foreground">
                  {stats[mode].toLocaleString()}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function TextStats({
  text,
  countMode,
  onCountModeChange,
  sourceInspection,
  forceStatic = false,
}: TextStatsProps) {
  const sourceSizeBytes = sourceInspection?.size_bytes ?? text.length;
  if (
    sourceInspection
    && (forceStatic || sourceSizeBytes > LIVE_TEXT_STATS_MAX_BYTES || text.length > LIVE_TEXT_STATS_MAX_BYTES)
  ) {
    return <StaticTextStats inspection={sourceInspection} />;
  }

  return (
    <LiveTextStats
      text={text}
      countMode={countMode}
      onCountModeChange={onCountModeChange}
      sourceSizeBytes={sourceSizeBytes}
    />
  );
}
