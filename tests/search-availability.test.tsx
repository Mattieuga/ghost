// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCloseSearchWhenUnavailable } from "../src/hooks/use-search";

function Harness({
  searchable,
  closeSearch,
}: {
  searchable: boolean | undefined;
  closeSearch: () => void;
}) {
  useCloseSearchWhenUnavailable(searchable, closeSearch);
  return null;
}

const mounted: Array<ReturnType<typeof createRoot>> = [];

afterEach(() => {
  while (mounted.length) act(() => mounted.pop()?.unmount());
});

describe("search availability", () => {
  it("closes search when a viewer transition makes it unavailable", async () => {
    const closeSearch = vi.fn();
    const root = createRoot(document.createElement("div"));
    mounted.push(root);

    await act(async () => {
      root.render(<Harness searchable closeSearch={closeSearch} />);
    });
    expect(closeSearch).not.toHaveBeenCalled();

    await act(async () => {
      root.render(<Harness searchable={false} closeSearch={closeSearch} />);
    });
    expect(closeSearch).toHaveBeenCalledOnce();
  });
});
