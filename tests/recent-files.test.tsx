// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storeMocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  load: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-store", () => ({
  load: storeMocks.load,
}));

import { useRecentFiles } from "../src/hooks/use-recent-files";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ root: ReturnType<typeof createRoot>; host: HTMLDivElement }> = [];

function RecentFilesHarness() {
  const { recentFiles, retargetRecentFiles, removeRecentFiles } = useRecentFiles();
  return (
    <div>
      <output>{recentFiles.join("|")}</output>
      <button onClick={() => retargetRecentFiles("/project/notes", "/project/archive")}>Rename folder</button>
      <button onClick={() => removeRecentFiles("/project/archive")}>Remove folder</button>
    </div>
  );
}

beforeEach(() => {
  storeMocks.get.mockReset().mockResolvedValue([
    "/project/notes/one.md",
    "/project/notes/nested/two.md",
    "/project/keep.md",
  ]);
  storeMocks.set.mockReset().mockResolvedValue(undefined);
  storeMocks.load.mockReset().mockResolvedValue({
    get: storeMocks.get,
    set: storeMocks.set,
  });
});
afterEach(() => {
  while (mounted.length) {
    const item = mounted.pop();
    act(() => item?.root.unmount());
    item?.host.remove();
  }
});

async function renderHarness() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  mounted.push({ root, host });

  await act(async () => {
    root.render(<RecentFilesHarness />);
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  return host;
}

async function click(button: HTMLButtonElement) {
  await act(async () => {
    button.click();
    await Promise.resolve();
  });
}

describe("useRecentFiles path maintenance", () => {
  it("retargets descendants on folder rename and removes descendants on delete", async () => {
    const host = await renderHarness();
    const buttons = host.querySelectorAll("button");

    await click(buttons[0]);
    expect(host.querySelector("output")?.textContent).toBe(
      "/project/archive/one.md|/project/archive/nested/two.md|/project/keep.md",
    );
    expect(storeMocks.set).toHaveBeenLastCalledWith("recent-files", [
      "/project/archive/one.md",
      "/project/archive/nested/two.md",
      "/project/keep.md",
    ]);

    await click(buttons[1]);
    expect(host.querySelector("output")?.textContent).toBe("/project/keep.md");
    expect(storeMocks.set).toHaveBeenLastCalledWith("recent-files", ["/project/keep.md"]);
  });
});
