// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pause: vi.fn(),
  play: vi.fn(),
  load: vi.fn(),
  asset: {
    sourceUrl: "asset://localhost/song.mp3?ghost-media=100-1" as string | null,
    sizeBytes: 4096 as number | null,
    modifiedMs: 100 as number | null,
    loading: false,
    error: null as string | null,
  },
}));

vi.mock("../src/hooks/use-media-asset", () => ({
  useMediaAsset: () => mocks.asset,
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { AudioViewer } from "../src/components/viewer/audio-viewer";

const mounted: Array<ReturnType<typeof createRoot>> = [];
const hosts: HTMLElement[] = [];

beforeEach(() => {
  mocks.pause.mockReset();
  mocks.play.mockReset().mockResolvedValue(undefined);
  mocks.load.mockReset();
  Object.assign(mocks.asset, {
    sourceUrl: "asset://localhost/song.mp3?ghost-media=100-1",
    sizeBytes: 4096,
    modifiedMs: 100,
    loading: false,
    error: null,
  });
  Object.defineProperty(HTMLMediaElement.prototype, "pause", { configurable: true, value: mocks.pause });
  Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: mocks.play });
  Object.defineProperty(HTMLMediaElement.prototype, "load", { configurable: true, value: mocks.load });
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

describe("AudioViewer", () => {
  it("loads a metadata-only WebKit engine with Ghost controls and releases it on unmount", async () => {
    const host = createHost();
    const root = createRoot(host);
    mounted.push(root);

    await act(async () => {
      root.render(<AudioViewer filePath="/project/song.mp3" />);
    });

    const audio = host.querySelector("audio");
    expect(audio?.preload).toBe("metadata");
    expect(audio?.controls).toBe(false);
    expect(host.querySelector("[aria-label='Play']")).not.toBeNull();
    expect(host.querySelector("[aria-label='Volume']")).not.toBeNull();
    expect(host.querySelector("[data-volume-level='high']")).not.toBeNull();
    expect(host.querySelector("[aria-label*='AirPlay']")).toBeNull();
    expect(host.querySelector("[aria-label='Playback speed, 1×']")).not.toBeNull();
    expect(host.querySelector("[data-playback-rate-gauge='1']")).not.toBeNull();
    expect(mocks.load).toHaveBeenCalledOnce();

    act(() => root.unmount());
    mounted.pop();
    expect(mocks.pause).toHaveBeenCalledOnce();
    expect(mocks.load).toHaveBeenCalledTimes(2);
  });

  it("plays from the keyboard only while the player card has focus", async () => {
    const host = createHost();
    const root = createRoot(host);
    mounted.push(root);

    await act(async () => {
      root.render(<AudioViewer filePath="/project/song.mp3" />);
    });
    const audio = host.querySelector("audio");
    const player = host.querySelector<HTMLElement>("[role='group']");
    expect(audio).not.toBeNull();
    expect(player).not.toBeNull();
    if (!audio || !player) throw new Error("audio player should render");
    Object.defineProperty(audio, "paused", { configurable: true, value: true });

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
    });
    expect(mocks.play).not.toHaveBeenCalled();

    act(() => {
      player.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    });
    expect(mocks.play).toHaveBeenCalledOnce();
  });

  it("seeks and controls volume through Ghost's controls", async () => {
    const host = createHost();
    const root = createRoot(host);
    mounted.push(root);

    await act(async () => {
      root.render(<AudioViewer filePath="/project/song.mp3" />);
    });
    const audio = host.querySelector("audio");
    const forward = host.querySelector<HTMLButtonElement>("[aria-label='Forward 15 seconds']");
    const mute = host.querySelector<HTMLButtonElement>("[aria-label='Mute']");
    if (!audio || !forward || !mute) throw new Error("custom audio controls should render");
    Object.defineProperty(audio, "duration", { configurable: true, value: 100 });
    Object.defineProperty(audio, "currentTime", { configurable: true, writable: true, value: 10 });
    Object.defineProperty(audio, "muted", { configurable: true, writable: true, value: false });

    act(() => forward.click());
    expect(audio.currentTime).toBe(25);

    act(() => mute.click());
    expect(audio.muted).toBe(true);
    expect(host.querySelector("[aria-label='Unmute']")).not.toBeNull();
    expect(host.querySelector("[data-volume-level='muted']")).not.toBeNull();

    act(() => {
      audio.muted = false;
      audio.volume = 0;
      audio.dispatchEvent(new Event("volumechange", { bubbles: true }));
    });
    expect(host.querySelector("[data-volume-level='muted']")).not.toBeNull();
  });

  it("reflects WebKit playback-rate changes in Ghost's speed control", async () => {
    const host = createHost();
    const root = createRoot(host);
    mounted.push(root);

    await act(async () => {
      root.render(<AudioViewer filePath="/project/song.mp3" />);
    });
    const audio = host.querySelector("audio");
    if (!audio) throw new Error("audio player should render");

    act(() => {
      audio.playbackRate = 1.5;
      audio.dispatchEvent(new Event("ratechange", { bubbles: true }));
    });

    expect(host.querySelector("[aria-label='Playback speed, 1.5×']")).not.toBeNull();
    const gauge = host.querySelector<SVGElement>("[data-playback-rate-gauge='1.5']");
    expect(gauge).not.toBeNull();
    expect(gauge?.querySelector("g")?.style.transform).toBe("rotate(18deg)");
  });

  it("keeps a stable media area and delays the loading message", async () => {
    vi.useFakeTimers();
    Object.assign(mocks.asset, {
      sourceUrl: null,
      sizeBytes: null,
      modifiedMs: null,
      loading: true,
    });
    const host = createHost();
    const root = createRoot(host);
    mounted.push(root);

    await act(async () => {
      root.render(<AudioViewer filePath="/project/song.mp3" />);
    });

    expect(host.querySelector("[data-audio-body]")?.classList.contains("min-h-36")).toBe(true);
    expect(host.textContent).not.toContain("Loading audio…");

    act(() => vi.advanceTimersByTime(99));
    expect(host.textContent).not.toContain("Loading audio…");

    act(() => vi.advanceTimersByTime(1));
    expect(host.textContent).toContain("Loading audio…");
  });

  it("focuses the player when the surrounding viewer surface is clicked", async () => {
    const host = createHost();
    const root = createRoot(host);
    mounted.push(root);

    await act(async () => {
      root.render(<AudioViewer filePath="/project/song.mp3" />);
    });

    const surface = host.querySelector<HTMLElement>("[data-audio-surface]");
    const player = host.querySelector<HTMLElement>("[data-viewer-focus-target]");
    if (!surface || !player) throw new Error("audio viewer should render its focus targets");

    act(() => {
      surface.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });

    expect(document.activeElement).toBe(player);
  });
});
