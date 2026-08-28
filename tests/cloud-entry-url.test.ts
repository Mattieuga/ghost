import { describe, expect, it } from "vitest";
import { cloudWebEntryUrl } from "../src/cloud/cloud-entry-url";

describe("browser fallback for the desktop entry", () => {
  it("routes to web.html without dropping an auth callback", () => {
    expect(cloudWebEntryUrl("http://localhost:1420/?code=secret&next=cloud#state"))
      .toBe("http://localhost:1420/web.html?code=secret&next=cloud#state");
  });
});
