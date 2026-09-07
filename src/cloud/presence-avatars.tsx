/** Who is in the document right now, as initials. Same on the Mac and the web. */
export function PresenceAvatars({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  const visible = names.slice(0, 3);
  return (
    <div className="flex -space-x-1" title={`Active: ${names.join(", ")}`} aria-label={`Active: ${names.join(", ")}`}>
      {visible.map((name, index) => (
        <span
          key={name}
          className="flex size-7 items-center justify-center rounded-full border-2 border-background bg-secondary text-[10px] font-semibold uppercase text-secondary-foreground"
          style={{ zIndex: visible.length - index }}
        >
          {name.trim().charAt(0) || "?"}
        </span>
      ))}
      {names.length > visible.length ? (
        <span className="flex size-7 items-center justify-center rounded-full border-2 border-background bg-secondary text-[9px] text-secondary-foreground">
          +{names.length - visible.length}
        </span>
      ) : null}
    </div>
  );
}
