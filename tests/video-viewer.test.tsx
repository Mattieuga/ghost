// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  pause: vi.fn(),
  play: vi.fn(),
  load: vi.fn(),
  requestFullscreen: vi.fn(),
  exitFullscreen: vi.fn(),
  asset: {
    sourceUrl: "asset://localhost/movie.mp4?ghost-media=100-1" as string | null,
    sizeBytes: 4 * 1024 * 1024 as number | null,
    modifiedMs: 100 as number | null,
    loading: false,
    error: null as string | null,
  },
}));

vi.mock("../src/hooks/use-media-asset", () => ({
  useMediaAsset: () => mocks.asset,
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { VideoViewer } from "../src/components/viewer/video-viewer";

const mounted: Array<ReturnType<typeof createRoot>> = [];
const hosts: HTMLElement[] = [];

beforeEach(() => {
  mocks.pause.mockReset();
  mocks.play.mockReset().mockResolvedValue(undefined);
  mocks.load.mockReset();
  mocks.requestFullscreen.mockReset().mockResolvedValue(undefined);
  mocks.exitFullscreen.mockReset().mockResolvedValue(undefined);
  Object.assign(mocks.asset, {
    sourceUrl: "asset://localhost/movie.mp4?ghost-media=100-1",
    sizeBytes: 4 * 1024 * 1024,
    modifiedMs: 100,
    loading: false,
    error: null,
  });
  Object.defineProperty(HTMLMediaElement.prototype, "pause", { configurable: true, value: mocks.pause });
  Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: mocks.play });
  Object.defineProperty(HTMLMediaElement.prototype, "load", { configurable: true, value: mocks.load });
  Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: false });
  Object.defineProperty(document, "fullscreenElement", { configurable: true, writable: true, value: null });
  Object.defineProperty(document, "exitFullscreen", { configurable: true, value: mocks.exitFullscreen });
  Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
    configurable: true,
    value: mocks.requestFullscreen,
  });
});

afterEach(() => {
  while (mounted.length) act(() => mounted.pop()?.unmount());
  while (hosts.length) hosts.pop()?.remove();
  vi.useRealTimers();
});

function createHost() {
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  return host;
}

async function renderVideo(filePath = "/project/movie.mp4") {
  const host = createHost();
  const root = createRoot(host);
  mounted.push(root);
  await act(async () => {
    root.render(<VideoViewer filePath={filePath} />);
  });
  return { host, root };
}

describe("VideoViewer", () => {
  it("uses a metadata-only video engine and displays intrinsic metadata", async () => {
    const { host, root } = await renderVideo();
    const video = host.querySelector("video");
    if (!video) throw new Error("video viewer should render a video element");

    expect(video.preload).toBe("metadata");
    expect(video.controls).toBe(false);
    expect(video.hasAttribute("playsinline")).toBe(true);
    expect(host.querySelector("[aria-label='Play']")).not.toBeNull();
    expect(host.querySelector("[aria-label='Volume']")).not.toBeNull();
    expect(host.querySelector("[aria-label='Enter fullscreen']")).toBeNull();
    expect(mocks.load).toHaveBeenCalledOnce();

    Object.defineProperty(video, "videoWidth", { configurable: true, value: 1920 });
    Object.defineProperty(video, "videoHeight", { configurable: true, value: 1080 });
    Object.defineProperty(video, "duration", { configurable: true, value: 65 });
    act(() => video.dispatchEvent(new Event("loadedmetadata", { bubbles: true })));

    expect(host.textContent).toContain("1920×1080");
    expect(host.textContent).toContain("1:05");
    expect(host.textContent).toContain("4.0 MB");

    act(() => root.unmount());
    mounted.pop();
    expect(mocks.pause).toHaveBeenCalledOnce();
    expect(mocks.load).toHaveBeenCalledTimes(2);
  });

  it("keeps playback shortcuts scoped to the focused player", async () => {
    const { host } = await renderVideo();
    const video = host.querySelector("video");
    const player = host.querySelector<HTMLElement>("[data-viewer-focus-target]");
    if (!video || !player) throw new Error("video viewer should render its focus target");
    Object.defineProperty(video, "paused", { configurable: true, value: true });
    Object.defineProperty(video, "duration", { configurable: true, value: 100 });
    Object.defineProperty(video, "currentTime", { configurable: true, writable: true, value: 20 });
    Object.defineProperty(video, "volume", { configurable: true, writable: true, value: 1 });
    Object.defineProperty(video, "muted", { configurable: true, writable: true, value: false });

    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: " " })));
    expect(mocks.play).not.toHaveBeenCalled();

    act(() => player.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })));
    expect(mocks.play).toHaveBeenCalledOnce();

    act(() => player.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(video.currentTime).toBe(25);

    act(() => player.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    expect(video.volume).toBeCloseTo(0.95);

    act(() => player.dispatchEvent(new KeyboardEvent("keydown", { key: "m", bubbles: true })));
    expect(video.muted).toBe(true);
  });

  it("offers fullscreen only when WebKit exposes the capability", async () => {
    Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: true });
    const { host } = await renderVideo();
    const stage = host.querySelector<HTMLElement>("[data-video-stage]");
    const enter = host.querySelector<HTMLButtonElement>("[aria-label='Enter fullscreen']");
    if (!stage || !enter) throw new Error("fullscreen-capable video should render the control");

    await act(async () => enter.click());
    expect(mocks.requestFullscreen).toHaveBeenCalledOnce();

    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: stage });
    act(() => document.dispatchEvent(new Event("fullscreenchange")));
    expect(host.querySelector("[aria-label='Exit fullscreen']")).not.toBeNull();

    const player = host.querySelector<HTMLElement>("[data-viewer-focus-target]");
    if (!player) throw new Error("video player should render");
    await act(async () => {
      player.dispatchEvent(new KeyboardEvent("keydown", { key: "f", bubbles: true }));
    });
    expect(mocks.exitFullscreen).toHaveBeenCalledOnce();
  });

  it("restores player focus after Escape exits fullscreen", async () => {
    Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: true });
    const { host } = await renderVideo();
    const stage = host.querySelector<HTMLElement>("[data-video-stage]");
    const player = host.querySelector<HTMLElement>("[data-viewer-focus-target]");
    if (!stage || !player) throw new Error("fullscreen-capable video should render its focus target");

    player.focus();
    await act(async () => {
      player.dispatchEvent(new KeyboardEvent("keydown", { key: "f", bubbles: true }));
    });
    expect(mocks.requestFullscreen).toHaveBeenCalledOnce();

    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: stage });
    act(() => document.dispatchEvent(new Event("fullscreenchange")));

    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    expect(document.activeElement).toBe(outside);

    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
    act(() => document.dispatchEvent(new Event("fullscreenchange")));
    await act(async () => {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    });
    expect(document.activeElement).toBe(player);

    await act(async () => {
      player.dispatchEvent(new KeyboardEvent("keydown", { key: "f", bubbles: true }));
    });
    expect(mocks.requestFullscreen).toHaveBeenCalledTimes(2);
    outside.remove();
  });

  it("does not enter fullscreen when a playback control is double-clicked", async () => {
    Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: true });
    const { host } = await renderVideo();
    const stage = host.querySelector<HTMLElement>("[data-video-stage]");
    const play = host.querySelector<HTMLButtonElement>("[aria-label='Play']");
    if (!stage || !play) throw new Error("fullscreen-capable video should render controls");

    await act(async () => {
      play.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(mocks.requestFullscreen).not.toHaveBeenCalled();

    await act(async () => {
      stage.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(mocks.requestFullscreen).toHaveBeenCalledOnce();
  });

  it("hides idle controls and restores them when the pointer moves over the video", async () => {
    vi.useFakeTimers();
    const { host } = await renderVideo();
    const stage = host.querySelector<HTMLElement>("[data-video-stage]");
    const controls = host.querySelector<HTMLElement>("[data-video-controls]");
    if (!stage || !controls) throw new Error("video viewer should render its control overlay");

    expect(controls.dataset.controlsVisible).toBe("true");
    act(() => vi.advanceTimersByTime(1_999));
    expect(controls.dataset.controlsVisible).toBe("true");
    act(() => vi.advanceTimersByTime(1));
    expect(controls.dataset.controlsVisible).toBe("false");

    act(() => stage.dispatchEvent(new MouseEvent("mousemove", { bubbles: true })));
    expect(controls.dataset.controlsVisible).toBe("true");

    act(() => stage.dispatchEvent(new MouseEvent("mouseout", {
      bubbles: true,
      relatedTarget: document.body,
    })));
    expect(controls.dataset.controlsVisible).toBe("false");
  });

  it("reveals the controls when the focused player receives a keyboard command", async () => {
    vi.useFakeTimers();
    const { host } = await renderVideo();
    const player = host.querySelector<HTMLElement>("[data-viewer-focus-target]");
    const controls = host.querySelector<HTMLElement>("[data-video-controls]");
    if (!player || !controls) throw new Error("video viewer should render its keyboard target");

    act(() => vi.advanceTimersByTime(2_000));
    expect(controls.dataset.controlsVisible).toBe("false");

    act(() => player.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(controls.dataset.controlsVisible).toBe("true");
  });

  it("delays the loading message to avoid flashing for fast local files", async () => {
    vi.useFakeTimers();
    Object.assign(mocks.asset, {
      sourceUrl: null,
      sizeBytes: null,
      modifiedMs: null,
      loading: true,
    });
    const { host } = await renderVideo();

    expect(host.textContent).not.toContain("Loading video…");
    act(() => vi.advanceTimersByTime(99));
    expect(host.textContent).not.toContain("Loading video…");
    act(() => vi.advanceTimersByTime(1));
    expect(host.textContent).toContain("Loading video…");
  });

  it("surfaces codec failures with an external-open fallback", async () => {
    const { host } = await renderVideo("/project/archive.mkv");
    const video = host.querySelector("video");
    if (!video) throw new Error("video viewer should render");
    Object.defineProperty(video, "error", { configurable: true, value: { code: 4 } });

    act(() => video.dispatchEvent(new Event("error", { bubbles: true })));

    expect(host.textContent).toContain("not supported by WebKit");
    expect(host.querySelector("button")?.textContent).toContain("Open Externally");
  });
});
