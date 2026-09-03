import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appAssociation = JSON.parse(readFileSync(
  new URL("../site/.well-known/apple-app-site-association", import.meta.url),
  "utf8",
)) as {
  applinks: {
    details: Array<{
      appIDs: string[];
      components: Array<{ "/": string }>;
    }>;
  };
};

const tauriConfig = JSON.parse(readFileSync(
  new URL("../src-tauri/tauri.conf.json", import.meta.url),
  "utf8",
)) as {
  identifier: string;
  bundle: {
    macOS: { entitlements: string };
  };
  plugins: {
    "deep-link": {
      mobile: Array<{
        scheme: string[];
        host?: string;
        pathPrefix?: string[];
        appLink: boolean;
      }>;
    };
  };
};

describe("native authentication domain association", () => {
  it("keeps the hosted callback and macOS entitlement configuration aligned", () => {
    expect(tauriConfig.identifier).toBe("com.ghost.app");
    expect(tauriConfig.bundle.macOS.entitlements).toBe("Entitlements.plist");
    expect(readFileSync(
      new URL("../src-tauri/Entitlements.plist", import.meta.url),
      "utf8",
    )).toContain("<string>applinks:ghosteditor.app</string>");
    expect(tauriConfig.plugins["deep-link"].mobile).toContainEqual({
      scheme: ["https"],
      host: "ghosteditor.app",
      pathPrefix: ["/auth/native"],
      appLink: true,
    });
    expect(appAssociation.applinks.details).toContainEqual({
      appIDs: ["9D4KH55H97.com.ghost.app"],
      components: [{
        "/": "/auth/native/*",
        comment: "Open native Ghost authentication callbacks in the signed app.",
      }],
    });
  });

  it("keeps the hosted fallback page on the registered custom scheme", () => {
    const html = readFileSync(
      new URL("../site/auth/native/callback/index.html", import.meta.url),
      "utf8",
    );
    const script = readFileSync(
      new URL("../site/auth/native/callback/callback.js", import.meta.url),
      "utf8",
    );
    expect(html).toContain('href="ghost-md://auth/callback"');
    expect(script).toContain('new URL("ghost-md://auth/callback")');
    expect(script).toContain("callback.search = window.location.search");
    expect(script).toContain("callback.hash = window.location.hash");
  });
});
