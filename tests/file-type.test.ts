import { describe, expect, it } from "vitest";
import {
  classifyFile,
  isTextBackedFile,
  isMarkdown,
  isTextEditable,
  requiresMarkdownSourceMode,
} from "../src/lib/file-type";

describe("file classification", () => {
  it.each([
    ["notes.md", "markdown", "text", true],
    ["Sources/App.swift", "code", "text", true],
    ["Package.resolved", "code", "text", true],
    ["records.csv", "csv", "text", true],
    ["diagram.svg", "svg", "text", true],
    ["photo.PNG", "image", "viewer-owned", false],
    ["icon.icns", "image", "viewer-owned", false],
    ["manual.pdf", "pdf", "viewer-owned", false],
    ["typeface.woff2", "font", "viewer-owned", false],
    ["recording.FLAC", "audio", "asset-url", false],
    ["audiobook.m4b", "audio", "asset-url", false],
    ["demo.MP4", "video", "asset-url", false],
    ["capture.webm", "video", "asset-url", false],
    ["bundle.ZIP", "archive", "viewer-owned", false],
    ["source.tar.gz", "archive", "viewer-owned", false],
    ["backup.7z", "archive", "viewer-owned", false],
    ["picture.gz", "archive", "viewer-owned", false],
    ["picture.bz2", "archive", "viewer-owned", false],
    ["archive.ghost-data", "unsupported", "probe-text", false],
  ] as const)(
    "classifies %s as a %s viewer",
    (path, kind, loadMode, editable) => {
      expect(classifyFile(path)).toMatchObject({ kind, loadMode, editable });
    },
  );

  it("declares viewer capabilities instead of inferring them from binary status", () => {
    expect(classifyFile("notes.md")).toMatchObject({
      searchable: true,
      showTextStats: true,
      canOpenExternally: true,
    });
    expect(classifyFile("manual.pdf")).toMatchObject({
      searchable: false,
      showTextStats: false,
      canOpenExternally: true,
    });
    expect(classifyFile("song.mp3")).toMatchObject({
      kind: "audio",
      loadMode: "asset-url",
      searchable: false,
      editable: false,
      canOpenExternally: true,
      mimeType: "audio/mpeg",
    });
  });

  it("uses the load mode, not editability, to decide whether content is text-backed", () => {
    expect(isTextBackedFile(classifyFile("notes.md"))).toBe(true);
    expect(isTextBackedFile({
      ...classifyFile("notes.md"),
      loadMode: "viewer-owned",
      editable: true,
    })).toBe(false);
  });

  it.each([
    "mp3", "m4a", "m4b", "aac",
    "wav", "wave", "bwf",
    "aif", "aiff", "aifc", "caf",
    "flac", "ogg", "oga", "opus",
    "au", "snd", "ac3", "eac3", "ec3",
  ])("routes .%s through the audio viewer", (extension) => {
    expect(classifyFile(`recording.${extension}`)).toMatchObject({
      kind: "audio",
      loadMode: "asset-url",
      editable: false,
    });
  });

  it.each([
    ["mp4", "video/mp4"],
    ["m4v", "video/mp4"],
    ["mov", "video/quicktime"],
    ["qt", "video/quicktime"],
    ["webm", "video/webm"],
    ["ogv", "video/ogg"],
    ["mpeg", "video/mpeg"],
    ["mpg", "video/mpeg"],
    ["mpe", "video/mpeg"],
    ["m1v", "video/mpeg"],
    ["m2v", "video/mpeg"],
    ["ts", "video/mp2t"],
    ["m2ts", "video/mp2t"],
    ["mts", "video/mp2t"],
    ["3gp", "video/3gpp"],
    ["3g2", "video/3gpp2"],
    ["mkv", "video/x-matroska"],
    ["avi", "video/x-msvideo"],
    ["wmv", "video/x-ms-wmv"],
    ["asf", "video/x-ms-asf"],
    ["flv", "video/x-flv"],
    ["f4v", "video/mp4"],
  ] as const)("routes .%s through the video viewer", (extension, mimeType) => {
    expect(classifyFile(`clip.${extension}`)).toMatchObject({
      kind: "video",
      loadMode: extension === "ts" || extension === "mts" ? "probe-text" : "asset-url",
      editable: false,
      mimeType,
    });
  });

  it("keeps Ogg audio and Ogg video extensions unambiguous", () => {
    expect(classifyFile("sound.ogg").kind).toBe("audio");
    expect(classifyFile("movie.ogv").kind).toBe("video");
  });

  it.each([
    ["zip", "application/zip"],
    ["tar", "application/x-tar"],
    ["tar.gz", "application/gzip"],
    ["tgz", "application/gzip"],
    ["tar.bz2", "application/x-bzip2"],
    ["tbz2", "application/x-bzip2"],
    ["tar.xz", "application/x-xz"],
    ["txz", "application/x-xz"],
    ["tar.zst", "application/zstd"],
    ["cpio", "application/x-cpio"],
    ["cpgz", "application/gzip"],
    ["7z", "application/x-7z-compressed"],
    ["rar", "application/vnd.rar"],
    ["gz", "application/gzip"],
    ["bz2", "application/x-bzip2"],
  ] as const)("routes .%s through the archive viewer", (extension, mimeType) => {
    expect(classifyFile(`bundle.${extension}`)).toMatchObject({
      kind: "archive",
      loadMode: "viewer-owned",
      editable: false,
      mimeType,
    });
  });
});

describe("Markdown editing mode selection", () => {
  it("opens MDX in source mode instead of the rich Markdown editor", () => {
    expect(isMarkdown("component.mdx")).toBe(false);
    expect(isTextEditable("component.mdx")).toBe(true);
    expect(requiresMarkdownSourceMode("component.mdx", "# Hello\n\n<Component />")).toBe(true);
  });

  it("keeps ordinary Markdown in the rich editor", () => {
    expect(requiresMarkdownSourceMode("notes.md", "# Hello\n\nPlain **Markdown**.")).toBe(false);
  });

  it.each([
    ["custom HTML", "Before\n\n<details><summary>More</summary>Hidden</details>"],
    ["ordinary comments", "Before\n\n<!-- preserve this exact comment -->"],
  ])("uses source mode for %s", (_label, content) => {
    expect(requiresMarkdownSourceMode("notes.md", content)).toBe(true);
  });

  it("ignores HTML examples inside fenced code", () => {
    const content = "```html\n<details><summary>Example</summary></details>\n```";
    expect(requiresMarkdownSourceMode("notes.md", content)).toBe(false);
  });

  it("allows Ghost-owned image and table metadata in the rich editor", () => {
    expect(
      requiresMarkdownSourceMode("notes.md", '<img src="./image.png" alt="" width="420">'),
    ).toBe(false);
    expect(
      requiresMarkdownSourceMode(
        "notes.md",
        '<!-- ghost-table-widths:[[[180],[null]],[[180],[null]]] -->\n' +
          "| Name | Value |\n| --- | --- |\n| Alpha | 1 |",
      ),
    ).toBe(false);
  });

  it.each([
    ["malformed table metadata", '<!-- ghost-table-widths:[not-json] -->\n| A |\n| --- |'],
    ["invalid table widths", '<!-- ghost-table-widths:[[[-1]]] -->\n| A |\n| --- |'],
    ["custom image attributes", '<img src="./image.png" width="420" class="framed">'],
    ["unresized HTML images", '<img src="./image.png" alt="Diagram">'],
    ["custom legacy table attributes", '<table class="data"><tr><td>A</td></tr></table>'],
  ])("keeps %s in source mode", (_label, content) => {
    expect(requiresMarkdownSourceMode("notes.md", content)).toBe(true);
  });

  it("allows only the legacy table HTML Ghost can migrate safely", () => {
    const legacy =
      '<table><tr><th colwidth="180"><strong>Name</strong></th>' +
      '<th><a href="https://example.com" title="Value">Value</a></th></tr></table>';
    expect(requiresMarkdownSourceMode("notes.md", legacy)).toBe(false);
  });
});
