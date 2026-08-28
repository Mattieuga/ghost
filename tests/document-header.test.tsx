// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentHeader } from "../src/components/editor/document-header";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ root: ReturnType<typeof createRoot>; host: HTMLDivElement }> = [];

afterEach(() => {
  while (mounted.length) {
    const item = mounted.pop();
    act(() => item?.root.unmount());
    item?.host.remove();
  }
});

describe("DocumentHeader", () => {
  it("shares the blurred breadcrumb and inline rename treatment", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    mounted.push({ root, host });
    const rename = vi.fn(async () => undefined);

    await act(async () => {
      root.render(
        <DocumentHeader
          pathSegments={["Plans", "Shared"]}
          fileName="Roadmap.md"
          onRename={rename}
          right={<button type="button">History</button>}
        />,
      );
    });

    const header = host.querySelector<HTMLElement>("[data-document-header]");
    expect(header?.className).toContain("backdrop-blur-sm");
    expect(header?.textContent).toContain("Plans / Shared");
    expect(header?.textContent).toContain("History");

    const title = Array.from(host.querySelectorAll("span"))
      .find((candidate) => candidate.textContent === "Roadmap.md") as HTMLElement;
    await act(async () => title.click());
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Document name"]');
    expect(input?.value).toBe("Roadmap.md");

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "Renamed.md");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
      input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await Promise.resolve();
    });

    expect(rename).toHaveBeenCalledWith("Renamed.md");
  });
});
