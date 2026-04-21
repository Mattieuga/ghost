import { useState, useRef, useEffect, useMemo } from "react";
import { estimateTokenCount } from "tokenx";
import { countWords } from "@/lib/editor-utils";
import type { Settings } from "@/hooks/use-settings";

type CountMode = Settings["countMode"];

interface TextStatsProps {
  text: string;
  countMode: CountMode;
  onCountModeChange: (mode: CountMode) => void;
}

const MODE_LABELS: Record<CountMode, string> = {
  words: "words",
  chars: "characters",
  lines: "lines",
  tokens: "tokens",
};

function computeStats(text: string) {
  return {
    words: countWords(text),
    chars: text.length,
    lines: text.split("\n").length,
    tokens: estimateTokenCount(text),
  };
}

export function TextStats({ text, countMode, onCountModeChange }: TextStatsProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const stats = useMemo(() => computeStats(text), [text]);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  const display = `${stats[countMode].toLocaleString()} ${MODE_LABELS[countMode]}`;

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
              <span>{stats[mode].toLocaleString()} {MODE_LABELS[mode]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
