// @vitest-environment happy-dom

import { act, useRef, type RefObject } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import { useReloadOnFocus } from "../src/hooks/use-reload-on-focus";

function Harness({ failed }: { failed: RefObject<boolean> }) {
  const applyContent = useRef(vi.fn(() => true));
  const contentRef = useRef<string | null>("local edit");
  const lastSaveTimestamp = useRef(0);
  const pendingSaveCount = useRef(0);

  useReloadOnFocus({
    getPath: () => "/tmp/notes.md",
    applyContent,
    contentRef,
    lastSaveTimestamp,
    pendingSaveCount,
    hasFailedSave: failed,
  });

  return null;
}

const mounted: Array<ReturnType<typeof createRoot>> = [];

afterEach(() => {
  invokeMock.mockReset();
  while (mounted.length) act(() => mounted.pop()?.unmount());
});

describe("useReloadOnFocus", () => {
  it("does not overwrite a local edit while its save is in recovery", async () => {
    const failed = { current: true } as RefObject<boolean>;
    const root = createRoot(document.createElement("div"));
    mounted.push(root);
    invokeMock.mockResolvedValue("disk version");

    await act(async () => {
      root.render(<Harness failed={failed} />);
    });
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });

    expect(invokeMock).not.toHaveBeenCalled();

    failed.current = false;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });

    expect(invokeMock).toHaveBeenCalledWith("read_file", { path: "/tmp/notes.md" });
  });
});
