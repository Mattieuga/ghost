import { describe, expect, it } from "vitest";
import { documentHash, parseWebRoute } from "../src/cloud/cloud-web-app";

describe("web routes", () => {
  it("recognises a document route and nothing else", () => {
    const id = "6f1d2c3b-4a5e-4f60-8b7c-9d0e1f2a3b4c";
    expect(parseWebRoute(documentHash(id))).toEqual({ kind: "document", id });
    expect(parseWebRoute("")).toEqual({ kind: "home" });
    expect(parseWebRoute("#share=abc")).toEqual({ kind: "home" });
    expect(parseWebRoute("#/d/not-a-uuid")).toEqual({ kind: "home" });
    expect(parseWebRoute("#/d/6f1d2c3b-4a5e-4f60-8b7c-9d0e1f2a3b4c/extra")).toEqual({ kind: "home" });
  });
});
