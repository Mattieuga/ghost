import { describe, expect, it } from "vitest";
import {
  cloudDocumentRef,
  documentRefKey,
  documentSourceCapabilities,
  localDocumentRef,
} from "../src/lib/document-ref";

describe("document references", () => {
  it("keeps local paths and cloud IDs in distinct key spaces", () => {
    expect(documentRefKey(localDocumentRef("/notes/shared.md"))).toBe(
      "local:/notes/shared.md",
    );
    expect(documentRefKey(cloudDocumentRef("document-123"))).toBe(
      "cloud:document-123",
    );
  });

  it("exposes filesystem-only actions only for local documents", () => {
    const local = documentSourceCapabilities(localDocumentRef("/notes/local.md"));
    const cloud = documentSourceCapabilities(cloudDocumentRef("cloud-id"));

    expect(local).toMatchObject({
      persistence: "versioned-file",
      subscription: "filesystem",
      revealInFinder: true,
      openExternally: true,
      sharing: false,
      assets: "companion-directory",
    });
    expect(cloud).toMatchObject({
      persistence: "collaborative",
      subscription: "collaboration",
      revealInFinder: false,
      openExternally: false,
      sharing: true,
      assets: "private-cloud",
    });
  });

  it("rejects empty source identities", () => {
    expect(() => localDocumentRef("")).toThrow("path");
    expect(() => cloudDocumentRef("")).toThrow("ID");
  });
});
