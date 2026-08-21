import { describe, expect, it } from "vitest";
import { formatDevWorkspaceLabel } from "../src/lib/dev-workspace-label";

describe("formatDevWorkspaceLabel", () => {
  it("falls back to DEV when empty", () => {
    expect(formatDevWorkspaceLabel(null)).toBe("DEV");
    expect(formatDevWorkspaceLabel("")).toBe("DEV");
    expect(formatDevWorkspaceLabel("   ")).toBe("DEV");
  });

  it("uses the last path segment, uppercased", () => {
    expect(formatDevWorkspaceLabel("keyboard-nav")).toBe("KEYBOARD-N");
    expect(formatDevWorkspaceLabel("fix/markdown-source-preservation")).toBe("MARKDOWN-S");
  });

  it("keeps short names intact", () => {
    expect(formatDevWorkspaceLabel("sidebar")).toBe("SIDEBAR");
  });
});
