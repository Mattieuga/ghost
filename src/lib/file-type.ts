import { LanguageDescription, type LanguageSupport } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { marked, type Token, type Tokens } from "marked";

const MARKDOWN_EXTENSIONS = new Set(["md", "markdown", "mkd", "mdown", "mkdn", "mdwn"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "icns", "heic", "heif", "tiff", "tif"]);
const PDF_EXTENSIONS = new Set(["pdf"]);
const FONT_EXTENSIONS = new Set(["ttf", "otf", "woff", "woff2"]);
const CSV_EXTENSIONS = new Set(["csv", "tsv"]);
const AUDIO_EXTENSIONS = new Set([
  "mp3", "m4a", "m4b", "aac",
  "wav", "wave", "bwf",
  "aif", "aiff", "aifc", "caf",
  "flac", "ogg", "oga", "opus",
  "au", "snd", "ac3", "eac3", "ec3",
]);
const VIDEO_EXTENSIONS = new Set([
  "mp4", "m4v", "mov", "qt", "webm", "ogv",
  "mpeg", "mpg", "mpe", "m1v", "m2v",
  "ts", "m2ts", "mts", "3gp", "3g2",
  "mkv", "avi", "wmv", "asf", "flv", "f4v",
]);
// Both are TypeScript extensions as well as MPEG transport-stream extensions.
// Probe their contents before deciding between the code and video viewers.
const AMBIGUOUS_VIDEO_TEXT_EXTENSIONS = new Set(["ts", "mts"]);

export type ViewerKind =
  | "markdown"
  | "code"
  | "csv"
  | "svg"
  | "image"
  | "pdf"
  | "font"
  | "audio"
  | "video"
  | "unsupported";

export type FileLoadMode = "text" | "probe-text" | "viewer-owned" | "asset-url";

/**
 * The complete set of decisions callers need after identifying a file.
 * Keep this framework-independent: React routing belongs in FileViewer.
 */
export interface FileDescriptor {
  readonly kind: ViewerKind;
  readonly loadMode: FileLoadMode;
  readonly editable: boolean;
  readonly searchable: boolean;
  readonly showTextStats: boolean;
  readonly canOpenExternally: boolean;
  readonly mimeType?: string;
  readonly detectedByContent?: boolean;
}

const TEXT_CAPABILITIES = {
  loadMode: "text",
  editable: true,
  searchable: true,
  showTextStats: true,
  canOpenExternally: true,
} as const;

const VIEWER_CAPABILITIES = {
  loadMode: "viewer-owned",
  editable: false,
  searchable: false,
  showTextStats: false,
  canOpenExternally: true,
} as const;

const MARKDOWN_DESCRIPTOR: FileDescriptor = { kind: "markdown", ...TEXT_CAPABILITIES };
const CODE_DESCRIPTOR: FileDescriptor = { kind: "code", ...TEXT_CAPABILITIES };
const CSV_DESCRIPTOR: FileDescriptor = { kind: "csv", ...TEXT_CAPABILITIES };
const SVG_DESCRIPTOR: FileDescriptor = {
  kind: "svg",
  ...TEXT_CAPABILITIES,
  mimeType: "image/svg+xml",
};

const PDF_DESCRIPTOR: FileDescriptor = {
  kind: "pdf",
  ...VIEWER_CAPABILITIES,
  mimeType: "application/pdf",
};

const UNSUPPORTED_DESCRIPTOR: FileDescriptor = {
  kind: "unsupported",
  loadMode: "probe-text",
  editable: false,
  searchable: false,
  showTextStats: false,
  canOpenExternally: true,
};

const IMAGE_MIME_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  icns: "image/icns",
  heic: "image/heic",
  heif: "image/heif",
  tiff: "image/tiff",
  tif: "image/tiff",
};

const FONT_MIME_TYPES: Readonly<Record<string, string>> = {
  ttf: "font/ttf",
  otf: "font/otf",
  woff: "font/woff",
  woff2: "font/woff2",
};

const AUDIO_MIME_TYPES: Readonly<Record<string, string>> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  m4b: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  wave: "audio/wav",
  bwf: "audio/wav",
  aif: "audio/aiff",
  aiff: "audio/aiff",
  aifc: "audio/aiff",
  caf: "audio/x-caf",
  flac: "audio/flac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/opus",
  au: "audio/basic",
  snd: "audio/basic",
  ac3: "audio/ac3",
  eac3: "audio/eac3",
  ec3: "audio/eac3",
};

const VIDEO_MIME_TYPES: Readonly<Record<string, string>> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  qt: "video/quicktime",
  webm: "video/webm",
  ogv: "video/ogg",
  mpeg: "video/mpeg",
  mpg: "video/mpeg",
  mpe: "video/mpeg",
  m1v: "video/mpeg",
  m2v: "video/mpeg",
  ts: "video/mp2t",
  m2ts: "video/mp2t",
  mts: "video/mp2t",
  "3gp": "video/3gpp",
  "3g2": "video/3gpp2",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  wmv: "video/x-ms-wmv",
  asf: "video/x-ms-asf",
  flv: "video/x-flv",
  f4v: "video/mp4",
};

// Extra extensions that CodeMirror's official language catalog does not
// associate with a parser by default. Ambiguous .m files prefer Objective-C
// because Ghost is a macOS app and commonly opens Apple-platform projects.
const EXTENSION_LANGUAGE_ALIASES: Record<string, string> = {
  m: "Objective-C",
  swiftinterface: "Swift",
  metal: "C++",
  modulemap: "C++",
  cu: "C++",
  cuh: "C++",
  cppm: "C++",
  inl: "C++",
  ipp: "C++",
  ixx: "C++",
  tcc: "C++",
  tpp: "C++",
  txx: "C++",
  csx: "C#",
  cake: "C#",
  linq: "C#",
  fsx: "F#",
  fsi: "F#",
  hrl: "Erlang",
  rkt: "Scheme",
  asm: "Gas",
  zsh: "Shell",
  jsonc: "JSON",
  json5: "JSON",
  jsonl: "JSON",
  ndjson: "JSON",
  geojson: "JSON",
  topojson: "JSON",
  webmanifest: "JSON",
  har: "JSON",
  avsc: "JSON",
  tfstate: "JSON",
  plist: "XML",
  entitlements: "XML",
  storyboard: "XML",
  xib: "XML",
  stringsdict: "XML",
  csproj: "XML",
  fsproj: "XML",
  vbproj: "XML",
  props: "XML",
  targets: "XML",
  resx: "XML",
  atom: "XML",
  svelte: "HTML",
  astro: "JSX",
  ejs: "HTML",
  eta: "HTML",
  erb: "HTML",
  mustache: "HTML",
  cshtml: "HTML",
  razor: "HTML",
  heex: "HTML",
  leex: "HTML",
  templ: "HTML",
  njk: "Jinja",
  nunjucks: "Jinja",
  twig: "Jinja",
  http: "HTTP",
  rest: "HTTP",
  gemspec: "Ruby",
  podspec: "Ruby",
  rake: "Ruby",
  ru: "Ruby",
  php8: "PHP",
  command: "Shell",
  bazel: "Python",
  mdx: "Markdown",
};

const FILENAME_LANGUAGE_ALIASES: Record<string, string> = {
  "Package.resolved": "JSON",
  ".swift-format": "JSON",
  ".clang-format": "YAML",
  ".clang-tidy": "YAML",
  ".yamllint": "YAML",
  ".eslintrc": "JSON",
  ".prettierrc": "JSON",
  ".stylelintrc": "JSON",
  ".babelrc": "JSON",
  Brewfile: "Ruby",
  Podfile: "Ruby",
  Fastfile: "Ruby",
  Appfile: "Ruby",
  Vagrantfile: "Ruby",
  Dangerfile: "Ruby",
  Tiltfile: "Python",
  WORKSPACE: "Python",
  "WORKSPACE.bazel": "Python",
  "MODULE.bazel": "Python",
  "BUILD.bazel": "Python",
  "meson.build": "Python",
  "meson_options.txt": "Python",
};

// Known UTF-8 text formats without an official CodeMirror parser. They still
// open in CodeEditor with line numbers, search, folding, and normal editing.
const PLAIN_TEXT_EXTENSIONS = new Set([
  // Plain text and generic configuration
  "txt", "text", "log", "env", "cfg", "conf", "lock", "rtf", "rc",
  "gitignore", "gitattributes", "gitmodules", "gitconfig", "gitkeep", "mailmap",
  "editorconfig", "dockerignore", "htaccess", "htpasswd",
  "npmrc", "nvmrc", "prettierrc", "eslintrc", "babelrc", "browserslistrc",
  "stylelintrc", "eslintignore", "prettierignore",
  // Languages without an official catalog parser
  "fish", "nu", "zig", "zon", "nim", "nims", "nimble", "ex", "exs",
  "sol", "move", "cairo", "gleam", "roc", "odin", "jai", "mojo", "vala",
  "vapi", "awk", "sed", "ada", "adb", "ads", "apex", "trigger", "as",
  "ahk", "ahkl", "applescript", "bat", "cmd", "raku", "rakumod", "rakutest",
  "prolog", "qml",
  // Schemas, infrastructure, and data formats
  "graphql", "gql", "prisma", "thrift", "avro", "tf", "tfvars", "hcl",
  "nix", "dhall", "kdl", "cue", "rego", "nomad", "bicep", "jsonnet", "libsonnet",
  // Documentation, templates, build files, and shaders
  "rst", "adoc", "asciidoc", "org", "creole", "mk", "mak", "just",
  "xcconfig", "pbxproj", "strings", "glsl", "hlsl", "vert", "frag", "geom",
  "tesc", "tese", "comp",
]);

const PLAIN_TEXT_FILENAME_PATTERNS = [
  /^(?:(?:GNU|BSD)?Makefile|Justfile|Procfile|Caddyfile)(?:\..+)?$/i,
  /^\.(?:gitignore|gitattributes|gitmodules)(?:[._-].+)?$/i,
];

function getFileName(filePath: string): string {
  return filePath.split("/").pop() ?? filePath;
}

function getExtension(filePath: string): string {
  const name = getFileName(filePath);
  const dot = name.lastIndexOf(".");
  if (dot === -1) return "";
  return name.slice(dot + 1).toLowerCase();
}

function getLanguageDescription(filePath: string): LanguageDescription | null {
  const name = getFileName(filePath);
  const ext = getExtension(filePath);

  let languageName = FILENAME_LANGUAGE_ALIASES[name] ?? EXTENSION_LANGUAGE_ALIASES[ext];
  if (/^\.env(?:\..+)?$/i.test(name)) languageName = "Properties files";
  if (/^Dockerfile(?:\..+)?$/i.test(name)) languageName = "Dockerfile";

  if (languageName) {
    const aliasMatch = LanguageDescription.matchLanguageName(languages, languageName, false);
    if (aliasMatch) return aliasMatch;
  }

  const officialMatch = LanguageDescription.matchFilename(languages, name);
  // Filename-specific modes such as CMakeLists.txt, nginx.conf, and
  // extensions.conf should win over a generic plain-text extension.
  if (officialMatch?.filename?.test(name)) return officialMatch;
  if (PLAIN_TEXT_EXTENSIONS.has(ext)) return null;
  return officialMatch;
}

function isKnownPlainTextFilename(filePath: string): boolean {
  const name = getFileName(filePath);
  return PLAIN_TEXT_FILENAME_PATTERNS.some((pattern) => pattern.test(name));
}

export function isMarkdown(filePath: string): boolean {
  return MARKDOWN_EXTENSIONS.has(getExtension(filePath));
}

const GHOST_HTML_TABLE_TAGS = new Set([
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "colgroup", "col",
  "p", "strong", "b", "em", "i", "s", "del", "code", "a", "br",
]);

function hasOnlyAttributes(
  source: string,
  allowed: ReadonlySet<string>,
  validate?: (name: string, value: string) => boolean,
): boolean {
  let cursor = 0;
  const seen = new Set<string>();
  const attribute = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

  for (const match of source.matchAll(attribute)) {
    if (match.index === undefined || source.slice(cursor, match.index).trim()) return false;
    const name = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? "";
    if (!allowed.has(name) || seen.has(name) || (validate && !validate(name, value))) return false;
    seen.add(name);
    cursor = match.index + match[0].length;
  }

  return source.slice(cursor).trim() === "";
}

function isGhostTableWidthMetadata(source: string): boolean {
  const match = source.match(/^<!--\s*ghost-table-widths:(\[.*\])\s*-->$/s);
  if (!match) return false;

  try {
    const value: unknown = JSON.parse(match[1]);
    return Array.isArray(value) && value.every((row) =>
      Array.isArray(row) && row.every((cell) =>
        cell === null || (Array.isArray(cell) && cell.every((width) =>
          width === null || (typeof width === "number" && Number.isFinite(width) && width > 0)
        ))
      )
    );
  } catch {
    return false;
  }
}

function isGhostResizableImage(source: string): boolean {
  const match = source.match(/^<img\b([\s\S]*)>$/i);
  if (!match) return false;
  const attributes = match[1].replace(/\/\s*$/, "");
  const allowed = new Set(["src", "alt", "title", "width"]);
  if (!hasOnlyAttributes(attributes, allowed, (name, value) =>
    name !== "width" || (/^\d+$/.test(value) && Number(value) > 0)
  )) return false;

  const names = [...attributes.matchAll(/([A-Za-z_:][\w:.-]*)\s*=/g)]
    .map((attribute) => attribute[1].toLowerCase());
  return names.includes("src") && names.includes("width");
}

function isMigratableLegacyTable(source: string): boolean {
  if (!/^<table(?:\s|>)/i.test(source) || !/<\/table>\s*$/i.test(source)) return false;
  if (source.includes("<!--")) return false;

  const tag = /<(\/)?([A-Za-z][\w-]*)([^<>]*)>/g;
  let tagCount = 0;
  for (const match of source.matchAll(tag)) {
    tagCount += 1;
    const closing = Boolean(match[1]);
    const name = match[2].toLowerCase();
    if (!GHOST_HTML_TABLE_TAGS.has(name)) return false;

    const attributes = match[3].replace(/\/\s*$/, "");
    if (closing) {
      if (attributes.trim()) return false;
      continue;
    }

    if (name === "th" || name === "td") {
      if (!hasOnlyAttributes(attributes, new Set(["colwidth"]), (_attribute, value) =>
        /^\d+(?:,\d+)*$/.test(value) && value.split(",").every((width) => Number(width) > 0)
      )) return false;
    } else if (name === "a") {
      if (!hasOnlyAttributes(attributes, new Set(["href", "title"]))) return false;
    } else if (attributes.trim()) {
      return false;
    }
  }

  // Any unparsed tag-like construct could carry semantics Tiptap cannot
  // reproduce, so leave the whole document in source mode.
  const withoutTags = source.replace(tag, "");
  return tagCount > 0 && !/<[!/A-Za-z]/.test(withoutTags);
}

function isGhostOwnedHtml(raw: string): boolean {
  const trimmed = raw.trim();
  return isGhostTableWidthMetadata(trimmed)
    || isGhostResizableImage(trimmed)
    || isMigratableLegacyTable(trimmed);
}

function tokenContainsUnsupportedHtml(token: Token | Tokens.Generic): boolean {
  if (token.type === "html" && !isGhostOwnedHtml(String(token.raw ?? ""))) {
    return true;
  }

  const nested = (token as Token & { tokens?: Token[] }).tokens;
  if (nested?.some(tokenContainsUnsupportedHtml)) return true;

  const items = (token as Tokens.List).items;
  return Array.isArray(items) && items.some((item) => item.tokens?.some(tokenContainsUnsupportedHtml));
}

/**
 * Tiptap intentionally interprets recognized HTML instead of preserving its
 * source. Open those documents in CodeMirror so comments, custom blocks, and
 * exact tags cannot be silently rewritten. Ghost's own resized image/table
 * markup remains supported by the rich editor for backwards compatibility.
 */
export function requiresMarkdownSourceMode(filePath: string, content: string): boolean {
  if (getExtension(filePath) === "mdx") return true;
  if (!isMarkdown(filePath)) return false;

  try {
    return marked.lexer(content, { gfm: true }).some(tokenContainsUnsupportedHtml);
  } catch {
    return true;
  }
}

export function isImage(filePath: string): boolean {
  return IMAGE_EXTENSIONS.has(getExtension(filePath));
}

export function isPdf(filePath: string): boolean {
  return PDF_EXTENSIONS.has(getExtension(filePath));
}

export function isFont(filePath: string): boolean {
  return FONT_EXTENSIONS.has(getExtension(filePath));
}

export function isCsv(filePath: string): boolean {
  return CSV_EXTENSIONS.has(getExtension(filePath));
}

export function isSvg(filePath: string): boolean {
  return getExtension(filePath) === "svg";
}

export function isAudio(filePath: string): boolean {
  return AUDIO_EXTENSIONS.has(getExtension(filePath));
}

export function isVideo(filePath: string): boolean {
  return VIDEO_EXTENSIONS.has(getExtension(filePath));
}

export function isTextEditable(filePath: string): boolean {
  const ext = getExtension(filePath);
  return getLanguageDescription(filePath) !== null
    || PLAIN_TEXT_EXTENSIONS.has(ext)
    || isKnownPlainTextFilename(filePath);
}

interface FileTypeDefinition {
  matches(filePath: string): boolean;
  describe(filePath: string): FileDescriptor;
}

/** Ordered from the most specific viewer to the generic text editor. */
const FILE_TYPE_DEFINITIONS: readonly FileTypeDefinition[] = [
  { matches: isMarkdown, describe: () => MARKDOWN_DESCRIPTOR },
  {
    matches: isImage,
    describe: (filePath) => ({
      kind: "image",
      ...VIEWER_CAPABILITIES,
      mimeType: IMAGE_MIME_TYPES[getExtension(filePath)],
    }),
  },
  { matches: isPdf, describe: () => PDF_DESCRIPTOR },
  {
    matches: isFont,
    describe: (filePath) => ({
      kind: "font",
      ...VIEWER_CAPABILITIES,
      mimeType: FONT_MIME_TYPES[getExtension(filePath)],
    }),
  },
  {
    matches: isAudio,
    describe: (filePath) => ({
      kind: "audio",
      ...VIEWER_CAPABILITIES,
      loadMode: "asset-url",
      mimeType: AUDIO_MIME_TYPES[getExtension(filePath)],
    }),
  },
  {
    matches: isVideo,
    describe: (filePath) => ({
      kind: "video",
      ...VIEWER_CAPABILITIES,
      loadMode: AMBIGUOUS_VIDEO_TEXT_EXTENSIONS.has(getExtension(filePath))
        ? "probe-text"
        : "asset-url",
      mimeType: VIDEO_MIME_TYPES[getExtension(filePath)],
    }),
  },
  { matches: isSvg, describe: () => SVG_DESCRIPTOR },
  { matches: isCsv, describe: () => CSV_DESCRIPTOR },
  { matches: isTextEditable, describe: () => CODE_DESCRIPTOR },
];

/**
 * Classify by the most specific known handler first. Unknown files are not
 * assumed to be binary: the shared loader resolves their bounded text probe.
 */
export function classifyFile(filePath: string): FileDescriptor {
  for (const definition of FILE_TYPE_DEFINITIONS) {
    if (definition.matches(filePath)) return definition.describe(filePath);
  }
  return UNSUPPORTED_DESCRIPTOR;
}

/** Turn a successful unknown-file text probe into an ordinary code document. */
export function resolveProbedText(descriptor: FileDescriptor): FileDescriptor {
  if (descriptor.loadMode !== "probe-text") return descriptor;
  return { ...CODE_DESCRIPTOR, detectedByContent: true };
}

/** True only when the shared loader supplied UTF-8 text for this descriptor. */
export function isTextBackedFile(
  descriptor: FileDescriptor | null | undefined,
): descriptor is FileDescriptor & { loadMode: "text" } {
  return descriptor?.loadMode === "text";
}

export async function getLanguageSupport(filePath: string): Promise<LanguageSupport | null> {
  const description = getLanguageDescription(filePath);
  return description ? description.load() : null;
}
