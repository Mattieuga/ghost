import { useEffect, type RefObject } from "react";
import { ChevronUp, ChevronDown, ChevronRight, X } from "lucide-react";

interface SearchBarProps {
  mode: "find" | "replace";
  searchTerm: string;
  replaceTerm: string;
  onSearchTermChange: (value: string) => void;
  onReplaceTermChange: (value: string) => void;
  resultCount: number;
  resultIndex: number;
  onNext: () => void;
  onPrevious: () => void;
  onReplace: () => void;
  onReplaceAll: () => void;
  onClose: () => void;
  onToggleMode: () => void;
  searchInputRef: RefObject<HTMLInputElement | null>;
}

export function SearchBar({
  mode,
  searchTerm,
  replaceTerm,
  onSearchTermChange,
  onReplaceTermChange,
  resultCount,
  resultIndex,
  onNext,
  onPrevious,
  onReplace,
  onReplaceAll,
  onClose,
  onToggleMode,
  searchInputRef,
}: SearchBarProps) {
  // Auto-focus search input on mount
  useEffect(() => {
    searchInputRef.current?.focus();
  }, [searchInputRef]);

  const resultText = searchTerm
    ? resultCount > 0
      ? `${resultIndex + 1} of ${resultCount}`
      : "No results"
    : "";

  return (
    <div className="flex items-center gap-1 flex-1 min-w-0">
      <button
        onClick={onToggleMode}
        className="flex-shrink-0 p-0.5 rounded hover:bg-muted/50 text-muted-foreground transition-colors"
        title={mode === "find" ? "Show replace" : "Hide replace"}
      >
        {mode === "replace" ? (
          <ChevronDown size={14} />
        ) : (
          <ChevronRight size={14} />
        )}
      </button>

      {/* Find input */}
      <input
        ref={searchInputRef}
        type="text"
        value={searchTerm}
        onChange={(e) => onSearchTermChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            onClose();
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (e.shiftKey) {
              onPrevious();
            } else {
              onNext();
            }
          }
        }}
        placeholder="Find..."
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        className="flex-1 min-w-[60px] h-6 bg-muted/40 rounded px-2 text-[13px] text-foreground placeholder:text-ring outline-none border border-transparent focus:border-ring/30"
      />

      {resultText && (
        <span className="flex-shrink-0 text-[11px] text-ring tabular-nums whitespace-nowrap">
          {resultText}
        </span>
      )}

      {/* Replace input — inline next to find */}
      {mode === "replace" && (
        <>
          <input
            type="text"
            value={replaceTerm}
            onChange={(e) => onReplaceTermChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                onClose();
              } else if (e.key === "Enter") {
                e.preventDefault();
                onReplace();
              }
            }}
            placeholder="Replace..."
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            className="flex-1 min-w-[60px] h-6 bg-muted/40 rounded px-2 text-[13px] text-foreground placeholder:text-ring outline-none border border-transparent focus:border-ring/30"
          />
          <button
            onClick={onReplace}
            disabled={resultCount === 0}
            className="flex-shrink-0 px-1.5 h-6 rounded text-[11px] text-muted-foreground hover:bg-muted/50 hover:text-foreground disabled:opacity-30 transition-colors whitespace-nowrap"
          >
            Replace
          </button>
          <button
            onClick={onReplaceAll}
            disabled={resultCount === 0}
            className="flex-shrink-0 px-1.5 h-6 rounded text-[11px] text-muted-foreground hover:bg-muted/50 hover:text-foreground disabled:opacity-30 transition-colors whitespace-nowrap"
          >
            All
          </button>
        </>
      )}

      <button
        onClick={onPrevious}
        disabled={resultCount === 0}
        className="flex-shrink-0 p-0.5 rounded hover:bg-muted/50 text-muted-foreground disabled:opacity-30 transition-colors"
        title="Previous (Shift+Enter)"
      >
        <ChevronUp size={14} />
      </button>
      <button
        onClick={onNext}
        disabled={resultCount === 0}
        className="flex-shrink-0 p-0.5 rounded hover:bg-muted/50 text-muted-foreground disabled:opacity-30 transition-colors"
        title="Next (Enter)"
      >
        <ChevronDown size={14} />
      </button>
      <button
        onClick={onClose}
        className="flex-shrink-0 p-0.5 rounded hover:bg-muted/50 text-muted-foreground transition-colors"
        title="Close (Escape)"
      >
        <X size={14} />
      </button>
    </div>
  );
}
