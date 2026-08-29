import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  invoke: vi.fn(),
  load: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: mocks.createClient,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

vi.mock("@tauri-apps/plugin-store", () => ({
  load: mocks.load,
}));

vi.mock("@/cloud/cloud-config", () => ({
  readCloudConfig: () => ({
    url: "https://project.supabase.co",
    publishableKey: "publishable-key",
    projectRef: "project",
  }),
}));

beforeEach(() => {
  mocks.createClient.mockReset().mockReturnValue({ client: "mac" });
  mocks.invoke.mockReset();
  mocks.get.mockReset().mockResolvedValue(undefined);
  mocks.set.mockReset().mockResolvedValue(undefined);
  mocks.remove.mockReset().mockResolvedValue(undefined);
  mocks.load.mockReset().mockResolvedValue({
    get: mocks.get,
    set: mocks.set,
    delete: mocks.remove,
  });
});

describe("Mac Cloud authentication storage", () => {
  it("persists the Supabase session in app data without invoking Keychain commands", async () => {
    const { getMacCloudClient, MAC_CLOUD_AUTH_REDIRECT_URL } =
      await import("../src/cloud/mac-cloud-client");
    expect(MAC_CLOUD_AUTH_REDIRECT_URL).toBe(
      "https://ghosteditor.app/auth/native/callback/",
    );
    expect(getMacCloudClient()).toEqual({ client: "mac" });

    const options = mocks.createClient.mock.calls[0]?.[2] as {
      auth: {
        storage: {
          getItem(key: string): Promise<string | null>;
          setItem(key: string, value: string): Promise<void>;
          removeItem(key: string): Promise<void>;
        };
      };
    };
    const storage = options.auth.storage;

    expect(await storage.getItem("ghost-cloud-auth-project")).toBeNull();
    await storage.setItem("ghost-cloud-auth-project", "session");
    await storage.removeItem("ghost-cloud-auth-project");

    expect(mocks.load).toHaveBeenCalledOnce();
    expect(mocks.load).toHaveBeenCalledWith("cloud-auth.json", {
      defaults: {},
      autoSave: true,
    });
    expect(mocks.set).toHaveBeenCalledWith("ghost-cloud-auth-project", "session");
    expect(mocks.remove).toHaveBeenCalledWith("ghost-cloud-auth-project");
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
