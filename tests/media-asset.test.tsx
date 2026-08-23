// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn(),
  listen: vi.fn(),
  unlisten: vi.fn(),
  fsChange: null as ((event: { payload: string }) => void) | null,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  convertFileSrc: mocks.convertFileSrc,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: mocks.listen,
}));

import { useMediaAsset } from "../src/hooks/use-media-asset";

function Harness({ filePath }: { filePath: string }) {
  const asset = useMediaAsset(filePath);
  return <output>{JSON.stringify(asset)}</output>;
}

const mounted: Array<ReturnType<typeof createRoot>> = [];

beforeEach(() => {
  mocks.invoke.mockReset().mockResolvedValue({
    canonical_path: "/canonical/song.mp3",
    size_bytes: 4096,
    modified_ms: 100,
  });
  mocks.convertFileSrc.mockReset().mockReturnValue("asset://localhost/canonical/song.mp3");
  mocks.unlisten.mockReset();
  mocks.fsChange = null;
  mocks.listen.mockReset().mockImplementation(async (_event, handler) => {
    mocks.fsChange = handler;
    return mocks.unlisten;
  });
});

afterEach(() => {
  while (mounted.length) act(() => mounted.pop()?.unmount());
});

async function renderHarness() {
  const host = document.createElement("div");
  const root = createRoot(host);
  mounted.push(root);
  await act(async () => {
    root.render(<Harness filePath="/project/song.mp3" />);
    await Promise.resolve();
    await Promise.resolve();
  });
  return { host, root };
}

describe("useMediaAsset", () => {
  it("grants and converts only the canonical media file", async () => {
    const { host } = await renderHarness();
    const state = JSON.parse(host.querySelector("output")?.textContent ?? "{}");

    expect(mocks.invoke).toHaveBeenCalledWith("prepare_media_asset", {
      path: "/project/song.mp3",
    });
    expect(mocks.convertFileSrc).toHaveBeenCalledWith("/canonical/song.mp3");
    expect(state).toMatchObject({
      sourceUrl: "asset://localhost/canonical/song.mp3?ghost-media=100-1",
      sizeBytes: 4096,
      loading: false,
      error: null,
    });
  });

  it("revisions the source after the open file changes and removes listeners on unmount", async () => {
    const { host, root } = await renderHarness();

    await act(async () => {
      mocks.fsChange?.({ payload: "/project/song.mp3" });
      await Promise.resolve();
      await Promise.resolve();
    });
    const state = JSON.parse(host.querySelector("output")?.textContent ?? "{}");
    expect(state.sourceUrl).toBe("asset://localhost/canonical/song.mp3?ghost-media=100-2");

    act(() => root.unmount());
    mounted.pop();
    expect(mocks.unlisten).toHaveBeenCalledOnce();
  });

  it("ignores unrelated filesystem changes instead of cancelling a relevant refresh", async () => {
    const { host } = await renderHarness();
    expect(mocks.invoke).toHaveBeenCalledOnce();

    await act(async () => {
      mocks.fsChange?.({ payload: "/project/unrelated.txt" });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.invoke).toHaveBeenCalledOnce();
    expect(JSON.parse(host.querySelector("output")?.textContent ?? "{}").sourceUrl)
      .toBe("asset://localhost/canonical/song.mp3?ghost-media=100-1");

    await act(async () => {
      mocks.fsChange?.({ payload: "/canonical/song.mp3" });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(JSON.parse(host.querySelector("output")?.textContent ?? "{}").sourceUrl)
      .toBe("asset://localhost/canonical/song.mp3?ghost-media=100-2");

    await act(async () => {
      mocks.fsChange?.({ payload: "/canonical" });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.invoke).toHaveBeenCalledTimes(3);
    expect(JSON.parse(host.querySelector("output")?.textContent ?? "{}").sourceUrl)
      .toBe("asset://localhost/canonical/song.mp3?ghost-media=100-3");
  });

  it("recovers on focus after a transient media read failure", async () => {
    const { host } = await renderHarness();
    mocks.invoke.mockRejectedValueOnce(new Error("temporarily unavailable"));

    await act(async () => {
      mocks.fsChange?.({ payload: "/project/song.mp3" });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(JSON.parse(host.querySelector("output")?.textContent ?? "{}").error)
      .toBe("temporarily unavailable");

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
      await Promise.resolve();
    });
    const recovered = JSON.parse(host.querySelector("output")?.textContent ?? "{}");
    expect(recovered.sourceUrl).toBe("asset://localhost/canonical/song.mp3?ghost-media=100-2");
    expect(recovered.error).toBeNull();
  });
});
