import { describe, expect, it } from "vitest";
import { resolveCloudConfig } from "../src/cloud/cloud-config";

describe("cloud configuration", () => {
  it("requires both public client settings", () => {
    expect(resolveCloudConfig({})).toBeNull();
    expect(resolveCloudConfig({ VITE_SUPABASE_URL: "https://ghost.supabase.co" })).toBeNull();
  });

  it("derives a stable project-scoped browser session key", () => {
    expect(resolveCloudConfig({
      VITE_SUPABASE_URL: "https://ghost-project.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    })).toEqual({
      url: "https://ghost-project.supabase.co",
      publishableKey: "sb_publishable_test",
      projectRef: "ghost-project",
    });
  });

  it("rejects insecure remote endpoints", () => {
    expect(() => resolveCloudConfig({
      VITE_SUPABASE_URL: "http://example.com",
      VITE_SUPABASE_PUBLISHABLE_KEY: "public-key",
    })).toThrow("HTTPS");
  });

  it("allows local Supabase development", () => {
    expect(resolveCloudConfig({
      VITE_SUPABASE_URL: "http://localhost:54321",
      VITE_SUPABASE_PUBLISHABLE_KEY: "public-key",
    })?.projectRef).toBe("localhost");
  });
});
