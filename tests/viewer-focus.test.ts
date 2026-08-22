// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { focusViewerTarget } from "../src/lib/editor-utils";

afterEach(() => {
  document.body.replaceChildren();
});

describe("focusViewerTarget", () => {
  it("focuses the primary target declared by an interactive viewer", () => {
    const container = document.createElement("main");
    const target = document.createElement("div");
    target.tabIndex = 0;
    target.dataset.viewerFocusTarget = "";
    container.append(target);
    document.body.append(container);

    expect(focusViewerTarget(container)).toBe(true);
    expect(document.activeElement).toBe(target);
  });

  it("leaves focus alone when a viewer has no primary target", () => {
    const container = document.createElement("main");
    document.body.append(container);

    expect(focusViewerTarget(container)).toBe(false);
    expect(document.activeElement).toBe(document.body);
  });
});
