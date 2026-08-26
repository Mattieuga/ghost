// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));

import { QuickLookViewer } from "../src/components/viewer/quick-look-viewer";

const mountedRoots: Array<ReturnType<typeof createRoot>> = [];

beforeEach(() => {
  mocks.invoke.mockReset().mockImplementation(async (command: string) => {
    if (command === "get_file_version") {
      return {
        canonical_path: "/project/proposal.docx",
        size_bytes: 4096,
        modified_ns: "1",
        device_id: "1",
        file_id: "2",
      };
    }
    return { mounted: true };
  });
  mocks.listen.mockReset().mockResolvedValue(() => undefined);
});

afterEach(() => {
  while (mountedRoots.length) act(() => mountedRoots.pop()?.unmount());
  document.body.replaceChildren();
});

describe("QuickLookViewer", () => {
  it("mounts a native surface, forwards focus, and releases it on unmount", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    mountedRoots.push(root);

    await act(async () => {
      root.render(<QuickLookViewer filePath="/project/proposal.docx" />);
    });

    expect(mocks.invoke).toHaveBeenCalledWith("show_quick_look_view", expect.objectContaining({
      path: "/project/proposal.docx",
      viewId: expect.stringMatching(/^quick-look-/),
    }));
    expect(host.textContent).not.toContain("Loading Quick Look…");

    const target = host.querySelector<HTMLElement>("[data-viewer-focus-target]");
    if (!target) throw new Error("Quick Look focus target should render");
    await act(async () => target.focus());
    expect(mocks.invoke).toHaveBeenCalledWith("quick_look_view_action", expect.objectContaining({
      action: "focus",
    }));

    act(() => root.unmount());
    mountedRoots.pop();
    expect(mocks.invoke).toHaveBeenCalledWith("hide_quick_look_view", expect.objectContaining({
      viewId: expect.stringMatching(/^quick-look-/),
    }));
  });

  it("keeps Open Externally available when the native mount fails", async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "show_quick_look_view") throw new Error("preview unavailable");
      if (command === "get_file_version") {
        return {
          canonical_path: "/project/proposal.docx",
          size_bytes: 4096,
          modified_ns: "1",
          device_id: "1",
          file_id: "2",
        };
      }
      return undefined;
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    mountedRoots.push(root);

    await act(async () => {
      root.render(<QuickLookViewer filePath="/project/proposal.docx" />);
    });

    expect(host.textContent).toContain("Unable to preview document");
    expect(host.textContent).toContain("Open Externally");
  });
});
