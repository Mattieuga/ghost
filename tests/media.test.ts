import { describe, expect, it } from "vitest";
import {
  formatMediaDuration,
  formatMediaFileSize,
  mediaPlaybackError,
  versionedMediaAssetUrl,
} from "../src/lib/media";

describe("media presentation helpers", () => {
  it.each([
    [0, "0:00"],
    [65.9, "1:05"],
    [3661, "1:01:01"],
  ] as const)("formats %s seconds", (seconds, expected) => {
    expect(formatMediaDuration(seconds)).toBe(expected);
  });

  it("formats large media sizes", () => {
    expect(formatMediaFileSize(1536)).toBe("1.5 KB");
    expect(formatMediaFileSize(2.5 * 1024 * 1024 * 1024)).toBe("2.5 GB");
  });

  it("adds a cache-busting revision without discarding an existing query", () => {
    expect(versionedMediaAssetUrl("asset://localhost/audio.mp3?token=x", 42, 3))
      .toBe("asset://localhost/audio.mp3?token=x&ghost-media=42-3");
  });

  it("explains unsupported codecs", () => {
    expect(mediaPlaybackError(4)).toContain("not supported");
  });
});
