export const DEV_WORKSPACE_LABEL_MAX = 10;

export function formatDevWorkspaceLabel(name: string | null | undefined): string {
  if (!name) return "DEV";
  const trimmed = name.trim();
  if (!trimmed) return "DEV";

  const parts = trimmed.split(/[/\\]+/).filter(Boolean);
  const last = parts[parts.length - 1] ?? trimmed;
  const compact = last.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!compact) return "DEV";

  const upper = compact.toUpperCase();
  return upper.length > DEV_WORKSPACE_LABEL_MAX
    ? upper.slice(0, DEV_WORKSPACE_LABEL_MAX)
    : upper;
}
