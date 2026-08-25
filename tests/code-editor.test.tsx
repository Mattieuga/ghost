// @vitest-environment happy-dom

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { installPointerFocusScrollGuard } from "../src/lib/codemirror-scroll";

const views: EditorView[] = [];
const hosts: HTMLElement[] = [];

afterEach(() => {
  while (views.length) views.pop()?.destroy();
  while (hosts.length) hosts.pop()?.remove();
});

describe("CodeEditor pointer focus", () => {
  it("moves the stale cursor under an ordinary pointer before focus can reset the viewport", () => {
    const host = document.createElement("div");
    document.body.append(host);
    hosts.push(host);

    const view = new EditorView({
      state: EditorState.create({ doc: Array.from({ length: 500 }, (_, index) => `line ${index}`).join("\n") }),
      parent: host,
    });
    views.push(view);
    const removeGuard = installPointerFocusScrollGuard(view);

    view.scrollDOM.scrollTop = 4_000;
    Object.defineProperty(view, "posAtCoords", {
      configurable: true,
      value: () => 2_000,
    });
    // Model WebKit revealing the current state selection during CodeMirror's
    // later focus step. The guard must have moved it before this listener runs.
    view.contentDOM.addEventListener("mousedown", (event) => {
      if (view.state.selection.main.head === 0) view.scrollDOM.scrollTop = 0;
      event.stopImmediatePropagation();
    }, true);
    view.contentDOM.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true,
      button: 0,
      clientX: 20,
      clientY: 20,
    }));

    expect(view.state.selection.main).toMatchObject({ anchor: 2_000, head: 2_000 });
    expect(view.scrollDOM.scrollTop).toBe(4_000);

    removeGuard();
  });

  it("leaves modified pointer selection to CodeMirror", () => {
    const host = document.createElement("div");
    document.body.append(host);
    hosts.push(host);

    const view = new EditorView({
      state: EditorState.create({ doc: "one\ntwo\nthree" }),
      parent: host,
    });
    views.push(view);
    const removeGuard = installPointerFocusScrollGuard(view);
    Object.defineProperty(view, "posAtCoords", {
      configurable: true,
      value: () => 8,
    });
    view.contentDOM.addEventListener("mousedown", (event) => event.stopImmediatePropagation(), true);

    view.contentDOM.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true,
      button: 0,
      shiftKey: true,
      clientX: 20,
      clientY: 20,
    }));

    expect(view.state.selection.main.head).toBe(0);
    removeGuard();
  });
});
