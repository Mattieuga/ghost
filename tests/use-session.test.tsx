// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { LocalCollaborationSession } from "../src/cloud/collaboration/local-session";
import type { CloudCollaborationSession, CloudCollaborationSnapshot } from "../src/cloud/collaboration/types";
import { usePresenceNames, useSessionSnapshot } from "../src/cloud/collaboration/use-session";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ root: ReturnType<typeof createRoot>; host: HTMLDivElement }> = [];
afterEach(() => {
  while (mounted.length) {
    const item = mounted.pop();
    act(() => item?.root.unmount());
    item?.host.remove();
  }
});

/** A session whose snapshot is a fresh object on every read, like the real adapter. */
function freshSnapshotSession(): CloudCollaborationSession & { emit(snapshot: CloudCollaborationSnapshot): void } {
  const base = new LocalCollaborationSession(new Y.Doc());
  const listeners = new Set<(snapshot: CloudCollaborationSnapshot) => void>();
  let reads = 0;
  return {
    document: base.document,
    awareness: base.awareness,
    role: "editor",
    getSnapshot: () => {
      reads += 1;
      if (reads > 50) throw new Error("getSnapshot read in a loop");
      return { ...base.getSnapshot() };
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    flush: async () => undefined,
    destroy: async () => undefined,
    emit: (snapshot) => listeners.forEach((listener) => listener(snapshot)),
  };
}

function Probe({ session, renders }: { session: CloudCollaborationSession | null; renders: { count: number } }) {
  renders.count += 1;
  const snapshot = useSessionSnapshot(session);
  const names = usePresenceNames(session);
  return <div data-sync={snapshot?.synchronization ?? "none"} data-names={names.join(",")} />;
}

describe("useSessionSnapshot", () => {
  it("does not re-render forever when every read is a new object, and follows updates", async () => {
    const session = freshSnapshotSession();
    const renders = { count: 0 };
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    mounted.push({ root, host });

    await act(async () => { root.render(<Probe session={session} renders={renders} />); });
    expect(renders.count).toBeLessThan(6);
    expect(host.firstElementChild?.getAttribute("data-sync")).toBe("synced");

    await act(async () => {
      session.emit({ ...session.getSnapshot(), synchronization: "offline" });
    });
    expect(host.firstElementChild?.getAttribute("data-sync")).toBe("offline");

    await act(async () => {
      session.awareness.setLocalStateField("user", { name: "Matt" });
    });
    expect(host.firstElementChild?.getAttribute("data-names")).toBe("Matt");
  });
});
