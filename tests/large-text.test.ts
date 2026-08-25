import { describe, expect, it } from "vitest";
import { textHighlightRange } from "../src/lib/large-text";

describe("large-text byte mapping", () => {
  it("maps native UTF-8 offsets to UTF-16 around multibyte text", () => {
    const text = "first 😀 snow 雪 target last";
    const prefix = "first 😀 snow 雪 ";
    const offset = new TextEncoder().encode(prefix).length;
    expect(textHighlightRange(text, 100, 100 + offset, "target")).toEqual({
      start: prefix.length,
      end: prefix.length + "target".length,
    });
  });

  it("rejects ranges outside the loaded window or inside a UTF-8 character", () => {
    expect(textHighlightRange("snow 雪", 10, 9, "snow")).toBeNull();
    expect(textHighlightRange("雪", 0, 1, "x")).toBeNull();
  });
});
