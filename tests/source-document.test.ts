import { describe, expect, it } from "vitest";
import { Text } from "@codemirror/state";
import { detectLineSeparator, iterateSourceChunks } from "../src/lib/source-document";

describe("source document streaming", () => {
  it("round-trips Unicode and CRLF without splitting surrogate pairs", () => {
    const document = Text.of(["alpha😀beta", "雪 and pepper", "last"]);
    const chunks = [...iterateSourceChunks({ document, lineSeparator: "\r\n" }, 7)];

    expect(chunks.join("")).toBe("alpha😀beta\r\n雪 and pepper\r\nlast");
    for (const chunk of chunks.slice(0, -1)) {
      const last = chunk.charCodeAt(chunk.length - 1);
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
    }
  });

  it("bounds chunks even for one very long line", () => {
    const document = Text.of(["x".repeat(100)]);
    const chunks = [...iterateSourceChunks({ document, lineSeparator: "\n" }, 16)];
    expect(chunks.every((chunk) => chunk.length <= 16)).toBe(true);
    expect(chunks.join("")).toBe("x".repeat(100));
  });

  it("detects the first line separator selected by a source file", () => {
    expect(detectLineSeparator("a\r\nb\n")).toBe("\r\n");
    expect(detectLineSeparator("a\rb")).toBe("\r");
    expect(detectLineSeparator("single line")).toBe("\n");
  });
});
