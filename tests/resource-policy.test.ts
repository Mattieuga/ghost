import { describe, expect, it } from "vitest";
import { classifyFile } from "../src/lib/file-type";
import {
  EXTREME_SOURCE_MAX_BYTES,
  LIVE_TEXT_STATS_MAX_BYTES,
  NORMAL_SOURCE_MAX_BYTES,
  NORMAL_SOURCE_MAX_LINE_BYTES,
  resolveSourceProfile,
  RICH_MARKDOWN_MAX_BYTES,
  shouldTrackLiveTextStats,
  TABLE_CSV_MAX_BYTES,
} from "../src/lib/resource-policy";

function inspection(sizeBytes: number, lineCount = 1) {
  return {
    version: {
      canonical_path: "/tmp/fixture",
      size_bytes: sizeBytes,
      modified_ns: "1",
      device_id: "1",
      file_id: "1",
    },
    size_bytes: sizeBytes,
    line_count: lineCount,
    line_count_complete: true,
    max_line_bytes: 80,
    looks_textual: true,
    line_separator: "\n",
  };
}

describe("resolveSourceProfile", () => {
  it("keeps ordinary source fully featured", () => {
    expect(resolveSourceProfile(classifyFile("notes.txt"), inspection(1024))).toBe("normal");
  });

  it("degrades rich Markdown and CSV before the general source threshold", () => {
    expect(resolveSourceProfile(
      classifyFile("notes.md"),
      inspection(RICH_MARKDOWN_MAX_BYTES + 1),
    )).toBe("large");
    expect(resolveSourceProfile(
      classifyFile("data.csv"),
      inspection(TABLE_CSV_MAX_BYTES + 1),
    )).toBe("large");
  });

  it("keeps plain text editable in reduced mode through 128 MiB", () => {
    expect(resolveSourceProfile(
      classifyFile("server.log"),
      inspection(NORMAL_SOURCE_MAX_BYTES + 1),
    )).toBe("large");
    expect(resolveSourceProfile(
      classifyFile("server.log"),
      inspection(100 * 1024 * 1024),
    )).toBe("large");
    expect(resolveSourceProfile(
      classifyFile("server.log"),
      inspection(EXTREME_SOURCE_MAX_BYTES),
    )).toBe("large");
  });

  it("routes source beyond the validated ceiling to bounded inspection", () => {
    expect(resolveSourceProfile(
      classifyFile("server.log"),
      inspection(EXTREME_SOURCE_MAX_BYTES + 1),
    )).toBe("extreme");
  });

  it("degrades or bounds pathological long lines", () => {
    expect(resolveSourceProfile(
      classifyFile("minified.js"),
      { ...inspection(1024), max_line_bytes: NORMAL_SOURCE_MAX_LINE_BYTES + 1 },
    )).toBe("large");
    expect(resolveSourceProfile(
      classifyFile("generated.sql"),
      { ...inspection(1024), max_line_bytes: 9 * 1024 * 1024 },
    )).toBe("extreme");
  });
});

describe("shouldTrackLiveTextStats", () => {
  it("never flattens reduced or windowed CodeMirror documents for statistics", () => {
    expect(shouldTrackLiveTextStats("large", inspection(1024), 1024)).toBe(false);
    expect(shouldTrackLiveTextStats("extreme", inspection(1024), 1024)).toBe(false);
  });

  it("stops tracking normal documents at the independent statistics budget", () => {
    expect(shouldTrackLiveTextStats(
      "normal",
      inspection(LIVE_TEXT_STATS_MAX_BYTES),
      LIVE_TEXT_STATS_MAX_BYTES,
    )).toBe(true);
    expect(shouldTrackLiveTextStats(
      "normal",
      inspection(LIVE_TEXT_STATS_MAX_BYTES + 1),
      1,
    )).toBe(false);
    expect(shouldTrackLiveTextStats(
      "normal",
      inspection(1),
      LIVE_TEXT_STATS_MAX_BYTES + 1,
    )).toBe(false);
  });
});
