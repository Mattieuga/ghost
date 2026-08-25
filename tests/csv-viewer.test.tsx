// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { CsvViewer } from "../src/components/viewer/csv-viewer";
import { parseCsv, serializeCsv, visibleCsvRowRange } from "../src/lib/csv";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<ReturnType<typeof createRoot>> = [];
const hosts: HTMLElement[] = [];

afterEach(() => {
  while (mounted.length) act(() => mounted.pop()?.unmount());
  while (hosts.length) hosts.pop()?.remove();
});

describe("CsvViewer", () => {
  it("preserves blank records, quoted newlines, and the original separator", () => {
    const rows = parseCsv('id,note\r\n1,"first\r\nsecond"\r\n\r\n', ",");
    expect(rows).toEqual([
      ["id", "note"],
      ["1", "first\r\nsecond"],
      [""],
    ]);
    expect(serializeCsv(rows, ",", "\r\n")).toBe('id,note\r\n1,"first\r\nsecond"\r\n');
  });

  it("calculates a bounded overscanned row window", () => {
    expect(visibleCsvRowRange(0, 640, 5_000)).toEqual({ start: 0, end: 30 });
    const middle = visibleCsvRowRange(32_000, 640, 5_000);
    expect(middle.start).toBeGreaterThan(900);
    expect(middle.end - middle.start).toBeLessThan(50);
    expect(visibleCsvRowRange(999_999, 640, 5_000).end).toBe(5_000);
  });

  it("mounts only the visible rows for a large CSV", async () => {
    const content = [
      "id,name",
      ...Array.from({ length: 5_000 }, (_, index) => `${index},Record ${index}`),
    ].join("\n");
    const host = document.createElement("div");
    document.body.append(host);
    hosts.push(host);
    const root = createRoot(host);
    mounted.push(root);

    await act(async () => {
      root.render(<CsvViewer filePath="records.csv" content={content} />);
    });

    expect(host.textContent).toContain("5,000 rows");
    expect(host.querySelectorAll("[data-csv-row-index]").length).toBeLessThan(60);
    expect(host.querySelector("[data-csv-row-index='1']")).not.toBeNull();
    expect(host.querySelector("[data-csv-row-index='5000']")).toBeNull();

    const scroll = host.querySelector<HTMLElement>("[data-csv-scroll-container]");
    if (!scroll) throw new Error("CSV scroll container should render");
    Object.defineProperty(scroll, "clientHeight", { configurable: true, value: 640 });
    await act(async () => {
      scroll.scrollTop = 160_000;
      scroll.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    expect(host.querySelector("[data-csv-row-index='1']")).toBeNull();
    expect(host.querySelector("[data-csv-row-index='5000']")).not.toBeNull();
  });
});
