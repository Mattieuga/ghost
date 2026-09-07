/** Who is in the document right now, as initials. Same on the Mac and the web. */
export function PresenceAvatars({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  const visible = names.slice(0, 3);
  return (
    <div className="flex -space-x-1" aria-label={`Also here: ${names.join(", ")}`}>
      {visible.map((name, index) => (
        <span
          key={name}
          title={name}
          className="flex size-7 cursor-default items-center justify-center rounded-full border-2 border-background bg-secondary text-[10px] font-semibold uppercase text-secondary-foreground transition-colors hover:z-10 hover:bg-accent hover:text-accent-foreground"
          style={{ zIndex: visible.length - index }}
        >
          {name.trim().charAt(0) || "?"}
        </span>
      ))}
      {names.length > visible.length ? (
        <span
          title={names.slice(visible.length).join(", ")}
          className="flex size-7 cursor-default items-center justify-center rounded-full border-2 border-background bg-secondary text-[9px] text-secondary-foreground transition-colors hover:z-10 hover:bg-accent hover:text-accent-foreground"
        >
          +{names.length - visible.length}
        </span>
      ) : null}
    </div>
  );
}
