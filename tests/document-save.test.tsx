// @vitest-environment happy-dom

import { act, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import { useDocumentSave } from "../src/hooks/use-document-save";

type SaveController = ReturnType<typeof useDocumentSave>;

function Harness({ onState }: { onState: (state: SaveController) => void }) {
  const knownDiskContent = useRef<string | null>("original");
  const lastSaveTimestamp = useRef(0);
  const state = useDocumentSave({ knownDiskContent, lastSaveTimestamp });

  useEffect(() => onState(state), [onState, state]);
  return null;
}

const mounted: Array<ReturnType<typeof createRoot>> = [];

afterEach(() => {
  invokeMock.mockReset();
  while (mounted.length) act(() => mounted.pop()?.unmount());
});

async function mountHarness() {
  const host = document.createElement("div");
  const root = createRoot(host);
  mounted.push(root);
  let state: SaveController | null = null;
  const onState = (nextState: SaveController) => { state = nextState; };

  await act(async () => {
    root.render(<Harness onState={onState} />);
  });

  return () => state as SaveController;
}

describe("useDocumentSave", () => {
  it("serializes writes and verifies each one against the last successful content", async () => {
    const firstWrite = Promise.withResolvers<void>();
    const secondWrite = Promise.withResolvers<void>();
    invokeMock
      .mockImplementationOnce(() => firstWrite.promise)
      .mockImplementationOnce(() => secondWrite.promise);
    const state = await mountHarness();

    let saveOne!: Promise<void>;
    let saveTwo!: Promise<void>;
    act(() => {
      saveOne = state().save("/tmp/notes.md", "one");
      saveTwo = state().save("/tmp/notes.md", "two");
    });
    await act(async () => { await Promise.resolve(); });

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock.mock.calls[0][1]).toMatchObject({
      content: "one",
      expectedContent: "original",
      force: false,
    });

    await act(async () => {
      firstWrite.resolve();
      await saveOne;
    });
    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(invokeMock.mock.calls[1][1]).toMatchObject({
      content: "two",
      expectedContent: "one",
      force: false,
    });

    await act(async () => {
      secondWrite.resolve();
      await saveTwo;
    });
    expect(state().status).toBe("saved");
  });

  it("keeps a conflicting edit available for an explicit forced retry", async () => {
    invokeMock
      .mockRejectedValueOnce({ kind: "conflict", message: "changed on disk" })
      .mockResolvedValueOnce(undefined);
    const state = await mountHarness();

    await act(async () => {
      await expect(state().save("/tmp/notes.md", "mine")).rejects.toMatchObject({
        kind: "conflict",
      });
    });

    expect(state().status).toBe("error");
    expect(state().error?.kind).toBe("conflict");

    await act(async () => {
      await state().retry(true);
    });

    expect(invokeMock.mock.calls[1][1]).toMatchObject({
      content: "mine",
      expectedContent: null,
      force: true,
    });
    expect(state().status).toBe("saved");
  });
});
