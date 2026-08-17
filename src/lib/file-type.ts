import { LanguageDescription, type LanguageSupport } from "@codemirror/language";
import { languages } from "@codemirror/language-data";

const MARKDOWN_EXTENSIONS = new Set(["md", "mdx", "markdown", "mkd", "mdown", "mkdn", "mdwn"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "icns", "heic", "heif", "tiff", "tif"]);
const PDF_EXTENSIONS = new Set(["pdf"]);
const FONT_EXTENSIONS = new Set(["ttf", "otf", "woff", "woff2"]);
const CSV_EXTENSIONS = new Set(["csv", "tsv"]);

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

export function isTextEditable(filePath: string): boolean {
  const ext = getExtension(filePath);
  return getLanguageDescription(filePath) !== null
    || PLAIN_TEXT_EXTENSIONS.has(ext)
    || isKnownPlainTextFilename(filePath);
}

export function isBinaryViewer(filePath: string): boolean {
  return !isMarkdown(filePath) && !isTextEditable(filePath) && !isCsv(filePath) && !isSvg(filePath);
}

/**
 * Unknown file types may still be ordinary UTF-8 text. Known image and PDF
 * formats keep their dedicated viewers instead of being guessed by content.
 */
export function shouldProbeTextContent(filePath: string): boolean {
  return isBinaryViewer(filePath) && !isImage(filePath) && !isPdf(filePath) && !isFont(filePath);
}

export async function getLanguageSupport(filePath: string): Promise<LanguageSupport | null> {
  const description = getLanguageDescription(filePath);
  return description ? description.load() : null;
}
