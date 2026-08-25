// @vitest-environment happy-dom

import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EAGER_TEXT_STATS_MAX_BYTES } from "../src/lib/resource-policy";

const estimateTokenCount = vi.hoisted(() => vi.fn(() => 42));
vi.mock("tokenx", () => ({ estimateTokenCount }));

import { TextStats } from "../src/components/editor/text-stats";
import type { SourceInspection } from "../src/lib/resource-policy";

function inspection(sizeBytes: number, lineCount = 10): SourceInspection {
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

function Harness({ sourceInspection }: { sourceInspection: SourceInspection }) {
  const [mode, setMode] = useState<"words" | "chars" | "lines" | "tokens">("words");
  return (
    <TextStats
      text={"alpha beta\ngamma"}
      countMode={mode}
      onCountModeChange={setMode}
      sourceInspection={sourceInspection}
    />
  );
}

const mounted: Array<ReturnType<typeof createRoot>> = [];

afterEach(() => {
  estimateTokenCount.mockClear();
  while (mounted.length) act(() => mounted.pop()?.unmount());
});

async function render(sourceInspection: SourceInspection) {
  const host = document.createElement("div");
  const root = createRoot(host);
  mounted.push(root);
  await act(async () => root.render(<Harness sourceInspection={sourceInspection} />));
  return host;
}

describe("TextStats", () => {
  it("shows original metadata without calculating live statistics for large files", async () => {
    const host = await render(inspection(17 * 1024 * 1024, 314_580));

    expect(host.textContent).toContain("17 MB · 314,580 lines");
    expect(estimateTokenCount).not.toHaveBeenCalled();
  });

  it("calculates only the selected statistic above the eager budget", async () => {
    const host = await render(inspection(EAGER_TEXT_STATS_MAX_BYTES + 1));

    expect(host.textContent).toContain("3 words");
    expect(estimateTokenCount).not.toHaveBeenCalled();

    await act(async () => {
      (host.querySelector("button") as HTMLButtonElement).click();
    });
    const tokenButton = Array.from(host.querySelectorAll("button"))
      .find((button) => button.textContent?.trim() === "tokens");
    expect(tokenButton).toBeDefined();

    await act(async () => tokenButton?.click());
    expect(estimateTokenCount).toHaveBeenCalledOnce();
    expect(host.textContent).toContain("42 tokens");
  });
});
