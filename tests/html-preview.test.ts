import { describe, expect, it } from "vitest";
import { withHtmlPreviewBase } from "../src/lib/html-preview";

describe("withHtmlPreviewBase", () => {
  it("inserts the base URL inside an existing head without changing the body", () => {
    expect(withHtmlPreviewBase(
      "<!doctype html><html><head><title>Test</title></head><body>Hi</body></html>",
      "asset://localhost/project/",
    )).toBe(
      "<!doctype html><html><head><base href=\"asset://localhost/project/\"><title>Test</title></head><body>Hi</body></html>",
    );
  });

  it("creates a head when the document has only an html element", () => {
    expect(withHtmlPreviewBase(
      "<html lang=\"en\"><body>Hi</body></html>",
      "asset://localhost/project/",
    )).toBe(
      "<html lang=\"en\"><head><base href=\"asset://localhost/project/\"></head><body>Hi</body></html>",
    );
  });

  it("does not override a base URL supplied by the document", () => {
    const source = "<head><base href=\"https://example.com/\"></head>";
    expect(withHtmlPreviewBase(source, "asset://localhost/project/")).toBe(source);
  });

  it("escapes a generated base attribute", () => {
    expect(withHtmlPreviewBase("<p>Hi</p>", 'asset://localhost/a&\"b/'))
      .toContain('href=\"asset://localhost/a&amp;&quot;b/\"');
  });

  it("leaves source untouched until a base URL is ready", () => {
    expect(withHtmlPreviewBase("<p>Hi</p>", "")).toBe("<p>Hi</p>");
  });
});
