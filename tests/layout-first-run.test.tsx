// @vitest-environment happy-dom

import "fake-indexeddb/auto";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileEntry } from "../src/types";
import type { TrackedRoot } from "../src/hooks/use-tracked-folders";

const GHOST = "/Users/me/Ghost";
const NOTES = `${GHOST}/Notes`;
const WELCOME = `${NOTES}/Welcome.md`;
const REPO = "/Users/me/code/repo";
const OTHER = "/Users/me/other";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  store: new Map<string, unknown>(),
  useCloudAccount: vi.fn(() => ({ kind: "signed-out" as const })),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
  emit: vi.fn(async () => {}),
  emitTo: vi.fn(async () => {}),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    setSize: vi.fn(async () => {}),
    setSizeConstraints: vi.fn(async () => {}),
  }),
  LogicalSize: class {
    constructor(public width: number, public height: number) {}
  },
}));
vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: async (key: string) => mocks.store.get(key),
    set: async (key: string, value: unknown) => {
      mocks.store.set(key, value);
    },
  })),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(async () => null) }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn(async () => null) }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn(async () => {}) }));
vi.mock("../src/cloud/mac-cloud-client", () => ({
  getMacCloudClient: () => null,
  MAC_CLOUD_AUTH_REDIRECT_URL: "https://ghosteditor.app/auth/native/callback/",
  openMacCloudOAuthUrl: async () => undefined,
}));
vi.mock("../src/cloud/use-cloud-account", () => ({ useCloudAccount: mocks.useCloudAccount }));
vi.mock("../src/cloud/use-mac-cloud-auth-callback", () => ({ useMacCloudAuthCallback: () => null }));

// The document pipeline has its own tests. Here it only needs to hand the
// layout a Markdown model for whatever path is opened.
vi.mock("../src/lib/local-document-source", async () => {
  const { classifyFile } = await import("../src/lib/file-type");
  const { LOCAL_DOCUMENT_CAPABILITIES } = await import("../src/lib/document-ref");
  return {
    tauriLocalDocumentSource: {
      kind: "local",
      capabilities: LOCAL_DOCUMENT_CAPABILITIES,
      load: async (ref: { path: string }) => ({
        path: ref.path,
        descriptor: classifyFile(ref.path),
        content: `# ${ref.path}\n`,
        version: {
          canonical_path: ref.path,
          size_bytes: 1,
          modified_ns: "1",
          device_id: null,
          file_id: null,
        },
        sourceDocument: null,
        sourceProfile: "normal",
        sourceInspection: null,
        lineSeparator: "\n",
        openPerformance: null,
      }),
      readText: vi.fn(),
      getVersion: vi.fn(),
      writeText: vi.fn(),
      beginSourceWrite: vi.fn(),
      appendSourceWrite: vi.fn(),
      commitSourceWrite: vi.fn(),
      abortSourceWrite: vi.fn(),
    },
  };
});
vi.mock("../src/components/editor/file-viewer", () => ({
  FileViewer: ({ filePath }: { filePath: string }) => (
    <div data-testid="file-viewer">{filePath}</div>
  ),
}));
vi.mock("../src/mirror/mirrored-document-editor", () => ({
  MirroredDocumentEditor: ({ path }: { path: string }) => (
    <div data-testid="mirrored-editor">{path}</div>
  ),
}));
vi.mock("../src/components/settings/settings-page", () => ({ SettingsPage: () => null }));
vi.mock("../src/components/ui/update-banner", () => ({ UpdateBanner: () => null }));
vi.mock("../src/components/command-palette/command-palette", () => ({
  CommandPalette: () => null,
}));

import { GhostLayout } from "../src/components/layout";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
HTMLElement.prototype.scrollIntoView = vi.fn();

const mounted: Array<{ root: ReturnType<typeof createRoot>; host: HTMLDivElement }> = [];
let entries: Record<string, FileEntry[]> = {};
let files: Map<string, string> = new Map();

function file(path: string): FileEntry {
  return {
    name: path.slice(path.lastIndexOf("/") + 1),
    path,
    is_directory: false,
    children: null,
  };
}

function token(path: string) {
  return {
    canonical_path: path,
    size_bytes: files.get(path)?.length ?? 0,
    modified_ns: String(files.get(path)?.length ?? 0),
    device_id: "1",
    file_id: String(path.length),
  };
}

function invokedCommands(): string[] {
  return mocks.invoke.mock.calls.map((call) => call[0] as string);
}

function createFileCalls(): Array<{ dir: string; name: string }> {
  return mocks.invoke.mock.calls
    .filter((call) => call[0] === "create_file")
    .map((call) => call[1] as { dir: string; name: string });
}

function trackedRoots(): TrackedRoot[] {
  return (mocks.store.get("tracked-roots") as TrackedRoot[] | undefined) ?? [];
}

function fileViewerPath(host: HTMLElement): string | null {
  return host.querySelector('[data-testid="file-viewer"]')?.textContent ?? null;
}

function mirroredEditorPath(host: HTMLElement): string | null {
  return host.querySelector('[data-testid="mirrored-editor"]')?.textContent ?? null;
}

function sectionHeaders(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll("[data-sidebar-section-header]"))
    .map((element) => element.getAttribute("data-sidebar-section-header") ?? "");
}

function buttonWithText(host: HTMLElement, text: string): HTMLButtonElement | undefined {
  return Array.from(host.querySelectorAll("button"))
    .find((button) => button.textContent?.trim() === text);
}

async function settle() {
  for (let round = 0; round < 10; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function pressCommandN() {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "n", metaKey: true }));
  });
  await settle();
}

async function renderLayout(): Promise<HTMLDivElement> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  await act(async () => {
    root.render(<GhostLayout />);
  });
  await settle();
  return host;
}

beforeEach(() => {
  mocks.store.clear();
  mocks.invoke.mockReset();
  mocks.useCloudAccount.mockReturnValue({ kind: "signed-out" });
  entries = {
    [NOTES]: [file(WELCOME)],
    [REPO]: [file(`${REPO}/README.md`)],
    [OTHER]: [],
  };
  files = new Map([
    [WELCOME, "# Welcome to Ghost\n\nThis is a note.\n"],
    [`${REPO}/README.md`, "# Repo\n"],
  ]);
  mocks.invoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    const path = String(args?.path ?? "");
    switch (command) {
      case "ensure_notes_folder":
        return { path: NOTES, created: true, welcome_path: WELCOME };
      case "ghost_folder":
        return GHOST;
      case "read_directory":
        return entries[path] ?? [];
      case "is_directory":
        return path in entries;
      case "create_file": {
        const dir = String(args?.dir);
        const created = `${dir}/${String(args?.name)}`;
        (entries[dir] ??= []).push(file(created));
        files.set(created, "# Untitled\n");
        return created;
      }
      case "create_directory":
        return `${String(args?.parent)}/${String(args?.name)}`;
      case "read_file": {
        const content = files.get(path);
        if (content === undefined) throw new Error(`missing ${path}`);
        return content;
      }
      case "write_file":
        files.set(path, String(args?.content));
        return token(path);
      case "get_file_version":
        return token(path);
      case "hash_file":
        return `h${files.get(path)?.length ?? 0}`;
      case "hash_text_content":
        return `h${String(args?.text).length}`;
      case "create_folder_bookmark":
        return `bookmark:${path}`;
      case "resolve_folder_bookmark":
        throw new Error("bookmark data is not valid");
      case "inspect_sync_candidate":
        return {
          path,
          canonicalPath: path,
          home: "/Users/me",
          appDataDir: null,
          isDirectory: path in entries,
          isPackage: false,
          writable: true,
          ancestorVcs: [],
          ancestorManaged: [],
          descendantVcs: [],
          descendantManaged: [],
          syncService: null,
          externalVolume: false,
          fileCount: entries[path]?.length ?? 0,
          byteCount: 10,
          markdownCount: entries[path]?.length ?? 0,
          scanTruncated: false,
        };
      case "mounted_volumes":
        return [];
      default:
        return undefined;
    }
  });
});

afterEach(() => {
  while (mounted.length) {
    const item = mounted.pop();
    act(() => item?.root.unmount());
    item?.host.remove();
  }
});

describe("GhostLayout first run and sidebar", () => {
  it("seeds a mirrored Notes on a fresh install, opens the welcome note, and shows no account UI", async () => {
    const host = await renderLayout();

    expect(invokedCommands()).toContain("ensure_notes_folder");
    expect(host.textContent).toContain("Notes");
    expect(host.textContent).toContain("Welcome.md");
    expect(mirroredEditorPath(host)).toBe(WELCOME);
    expect(fileViewerPath(host)).toBeNull();

    for (const forbidden of ["Ghost Cloud", "Continue with Apple", "Loading Cloud", "Workspace"]) {
      expect(host.textContent).not.toContain(forbidden);
    }
    expect(host.querySelector('input[type="email"]')).toBeNull();
    expect(sectionHeaders(host)).toEqual([]);

    const roots = trackedRoots();
    expect(roots.map((root) => root.path)).toEqual([NOTES]);
    expect(roots[0]?.kind).toBe("mirrored");
    expect(roots[0]?.bookmark).toBe(`bookmark:${NOTES}`);
    expect(files.has(`${NOTES}/.ghost/index.json`)).toBe(true);
  });

  it("migrates the legacy folder list in order and does not create Notes", async () => {
    mocks.store.set("tracked-folders", [REPO, OTHER]);

    const host = await renderLayout();

    expect(invokedCommands()).not.toContain("ensure_notes_folder");
    expect(host.textContent).toContain("repo");
    expect(host.textContent).toContain("other");
    expect(host.textContent).not.toContain("Welcome");
    expect(fileViewerPath(host)).toBeNull();

    const roots = trackedRoots();
    expect(roots.map((root) => root.path)).toEqual([REPO, OTHER]);
    expect(roots.every((root) => root.kind === "plain")).toBe(true);
    expect(new Set(roots.map((root) => root.id)).size).toBe(2);
  });

  it("adopts a plain folder under ~/Ghost left over from before the mirror engine", async () => {
    mocks.store.set("tracked-roots", [{ id: "root-notes", path: NOTES, kind: "plain" }]);

    await renderLayout();

    expect(trackedRoots()[0]).toMatchObject({ id: "root-notes", path: NOTES, kind: "mirrored" });
  });

  it("leaves an emptied sidebar empty and offers a new file or a folder", async () => {
    mocks.store.set("tracked-roots", []);

    const host = await renderLayout();

    expect(invokedCommands()).not.toContain("ensure_notes_folder");
    expect(host.textContent).toContain("Nothing open");
    expect(buttonWithText(host, "New File")).toBeDefined();
    expect(buttonWithText(host, "Open Folder…")).toBeDefined();
  });

  it("routes ⌘N to Notes when nothing is open, and to the open file's folder otherwise", async () => {
    mocks.store.set("tracked-roots", [{ id: "root-repo", path: REPO, kind: "plain" }]);
    const host = await renderLayout();
    expect(fileViewerPath(host)).toBeNull();

    await pressCommandN();

    expect(invokedCommands()).toContain("ensure_notes_folder");
    expect(createFileCalls()).toEqual([{ dir: NOTES, name: "Untitled.md" }]);
    expect(trackedRoots().map((root) => [root.path, root.kind])).toEqual([[REPO, "plain"], [NOTES, "mirrored"]]);
    expect(mirroredEditorPath(host)).toBe(`${NOTES}/Untitled.md`);

    const readme = buttonWithText(host, "README.md");
    expect(readme).toBeDefined();
    await act(async () => {
      readme?.click();
    });
    await settle();
    expect(fileViewerPath(host)).toBe(`${REPO}/README.md`);
    expect(mirroredEditorPath(host)).toBeNull();

    await pressCommandN();

    expect(createFileCalls().at(-1)).toEqual({ dir: REPO, name: "Untitled.md" });
    expect(fileViewerPath(host)).toBe(`${REPO}/Untitled.md`);
  });

  it("splits the sidebar into Cloud and On This Mac only once signed in", async () => {
    mocks.store.set("tracked-roots", [
      { id: "root-repo", path: REPO, kind: "plain" },
      { id: "root-notes", path: NOTES, kind: "mirrored", bookmark: "b" },
    ]);
    mocks.useCloudAccount.mockReturnValue({
      kind: "signed-in",
      user: { id: "user-1", email: "me@example.com" },
    } as never);

    const host = await renderLayout();

    expect(sectionHeaders(host)).toEqual(["Cloud", "On This Mac"]);
    const cloud = host.querySelector('[data-sidebar-section="cloud"]');
    const mac = host.querySelector('[data-sidebar-section="mac"]');
    expect(cloud?.textContent).toContain("Notes");
    expect(cloud?.textContent).not.toContain("repo");
    expect(mac?.textContent).toContain("repo");
    expect(mac?.textContent).not.toContain("Notes");
    expect(host.textContent).not.toContain("Open a folder…");
  });

  it("keeps an empty On This Mac section visible with an Open a folder row", async () => {
    mocks.store.set("tracked-roots", [{ id: "root-notes", path: NOTES, kind: "mirrored", bookmark: "b" }]);
    mocks.useCloudAccount.mockReturnValue({
      kind: "signed-in",
      user: { id: "user-1", email: "me@example.com" },
    } as never);

    const host = await renderLayout();

    expect(sectionHeaders(host)).toEqual(["Cloud", "On This Mac"]);
    expect(host.querySelector('[data-sidebar-section="mac"]')?.textContent).toContain("Open a folder…");
  });
});
