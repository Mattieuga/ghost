import { describe, expect, it, vi } from "vitest";
import {
  loadFileModel,
  type FileLoaderBackend,
} from "../src/lib/file-loader";

function backend(overrides: Partial<FileLoaderBackend> = {}): FileLoaderBackend {
  return {
    readText: vi.fn(async () => "known text"),
    probeText: vi.fn(async () => null),
    ...overrides,
  };
}

describe("loadFileModel", () => {
  it("reads known text without probing it", async () => {
    const reader = backend();

    const model = await loadFileModel("notes.md", reader);

    expect(model).toMatchObject({
      path: "notes.md",
      content: "known text",
      descriptor: { kind: "markdown", editable: true },
    });
    expect(reader.readText).toHaveBeenCalledWith("notes.md");
    expect(reader.probeText).not.toHaveBeenCalled();
  });

  it.each(["photo.jpg", "manual.pdf", "font.otf"])(
    "leaves known viewer content to the viewer for %s",
    async (path) => {
      const reader = backend();

      const model = await loadFileModel(path, reader);

      expect(model.content).toBe("");
      expect(model.descriptor.loadMode).toBe("viewer-owned");
      expect(reader.readText).not.toHaveBeenCalled();
      expect(reader.probeText).not.toHaveBeenCalled();
    },
  );

  it("leaves seekable audio loading to the asset-backed viewer", async () => {
    const reader = backend();

    const model = await loadFileModel("recording.flac", reader);

    expect(model).toMatchObject({
      content: "",
      descriptor: { kind: "audio", loadMode: "asset-url", editable: false },
    });
    expect(reader.readText).not.toHaveBeenCalled();
    expect(reader.probeText).not.toHaveBeenCalled();
  });

  it("leaves seekable video loading to the asset-backed viewer", async () => {
    const reader = backend();

    const model = await loadFileModel("recording.webm", reader);

    expect(model).toMatchObject({
      content: "",
      descriptor: { kind: "video", loadMode: "asset-url", editable: false },
    });
    expect(reader.readText).not.toHaveBeenCalled();
    expect(reader.probeText).not.toHaveBeenCalled();
  });

  it("leaves archive inspection to the archive viewer", async () => {
    const reader = backend();

    const model = await loadFileModel("source.tar.gz", reader);

    expect(model).toMatchObject({
      content: "",
      descriptor: { kind: "archive", loadMode: "viewer-owned", editable: false },
    });
    expect(reader.readText).not.toHaveBeenCalled();
    expect(reader.probeText).not.toHaveBeenCalled();
  });

  it.each(["module.ts", "module.mts"])(
    "resolves ambiguous %s text to the code viewer",
    async (path) => {
      const reader = backend({ probeText: vi.fn(async () => "export const answer = 42;\n") });

      const model = await loadFileModel(path, reader);

      expect(model).toMatchObject({
        content: "export const answer = 42;\n",
        descriptor: { kind: "code", loadMode: "text", editable: true },
      });
      expect(reader.readText).not.toHaveBeenCalled();
      expect(reader.probeText).toHaveBeenCalledWith(path);
    },
  );

  it.each(["capture.ts", "capture.mts"])(
    "keeps ambiguous binary %s in the video viewer",
    async (path) => {
      const reader = backend({ probeText: vi.fn(async () => null) });

      const model = await loadFileModel(path, reader);

      expect(model).toMatchObject({
        content: "",
        descriptor: { kind: "video", loadMode: "probe-text", editable: false },
      });
      expect(reader.readText).not.toHaveBeenCalled();
      expect(reader.probeText).toHaveBeenCalledWith(path);
    },
  );

  it("promotes an unknown UTF-8 file to the code viewer", async () => {
    const reader = backend({ probeText: vi.fn(async () => "title: Example\n") });

    const model = await loadFileModel("metadata.obscure", reader);

    expect(model).toMatchObject({
      content: "title: Example\n",
      descriptor: {
        kind: "code",
        loadMode: "text",
        editable: true,
        detectedByContent: true,
      },
    });
    expect(reader.readText).not.toHaveBeenCalled();
    expect(reader.probeText).toHaveBeenCalledWith("metadata.obscure");
  });

  it("keeps an unknown binary file read-only", async () => {
    const reader = backend({ probeText: vi.fn(async () => null) });

    const model = await loadFileModel("payload.unknown", reader);

    expect(model).toMatchObject({
      content: "",
      descriptor: {
        kind: "unsupported",
        loadMode: "probe-text",
        editable: false,
      },
    });
  });
});
