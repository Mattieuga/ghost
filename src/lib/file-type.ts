import type { LanguageSupport } from "@codemirror/language";

const MARKDOWN_EXTENSIONS = new Set(["md", "mdx", "markdown"]);

const LANGUAGE_MAP: Record<string, () => Promise<LanguageSupport>> = {
  js: () => import("@codemirror/lang-javascript").then((m) => m.javascript({ jsx: false })),
  mjs: () => import("@codemirror/lang-javascript").then((m) => m.javascript({ jsx: false })),
  cjs: () => import("@codemirror/lang-javascript").then((m) => m.javascript({ jsx: false })),
  jsx: () => import("@codemirror/lang-javascript").then((m) => m.javascript({ jsx: true })),
  ts: () => import("@codemirror/lang-javascript").then((m) => m.javascript({ jsx: false, typescript: true })),
  tsx: () => import("@codemirror/lang-javascript").then((m) => m.javascript({ jsx: true, typescript: true })),
  py: () => import("@codemirror/lang-python").then((m) => m.python()),
  rs: () => import("@codemirror/lang-rust").then((m) => m.rust()),
  go: () => import("@codemirror/lang-go").then((m) => m.go()),
  c: () => import("@codemirror/lang-cpp").then((m) => m.cpp()),
  cpp: () => import("@codemirror/lang-cpp").then((m) => m.cpp()),
  cc: () => import("@codemirror/lang-cpp").then((m) => m.cpp()),
  h: () => import("@codemirror/lang-cpp").then((m) => m.cpp()),
  hpp: () => import("@codemirror/lang-cpp").then((m) => m.cpp()),
  java: () => import("@codemirror/lang-java").then((m) => m.java()),
  kt: () => import("@codemirror/lang-java").then((m) => m.java()),
  css: () => import("@codemirror/lang-css").then((m) => m.css()),
  scss: () => import("@codemirror/lang-css").then((m) => m.css()),
  less: () => import("@codemirror/lang-css").then((m) => m.css()),
  html: () => import("@codemirror/lang-html").then((m) => m.html()),
  htm: () => import("@codemirror/lang-html").then((m) => m.html()),
  vue: () => import("@codemirror/lang-html").then((m) => m.html()),
  svelte: () => import("@codemirror/lang-html").then((m) => m.html()),
  json: () => import("@codemirror/lang-json").then((m) => m.json()),
  jsonc: () => import("@codemirror/lang-json").then((m) => m.json()),
  yaml: () => import("@codemirror/lang-yaml").then((m) => m.yaml()),
  yml: () => import("@codemirror/lang-yaml").then((m) => m.yaml()),
  sql: () => import("@codemirror/lang-sql").then((m) => m.sql()),
  xml: () => import("@codemirror/lang-xml").then((m) => m.xml()),
  svg: () => import("@codemirror/lang-xml").then((m) => m.xml()),
  php: () => import("@codemirror/lang-php").then((m) => m.php()),
  md: () => import("@codemirror/lang-markdown").then((m) => m.markdown()),
  mdx: () => import("@codemirror/lang-markdown").then((m) => m.markdown()),
  markdown: () => import("@codemirror/lang-markdown").then((m) => m.markdown()),
};

const FILENAME_LANGUAGE_MAP: Record<string, () => Promise<LanguageSupport>> = {
  Dockerfile: () => import("@codemirror/lang-yaml").then((m) => m.yaml()),
  Makefile: () => import("@codemirror/lang-python").then((m) => m.python()),
  Gemfile: () => import("@codemirror/lang-python").then((m) => m.python()),
  Rakefile: () => import("@codemirror/lang-python").then((m) => m.python()),
};

function getFileName(filePath: string): string {
  return filePath.split("/").pop() ?? filePath;
}

function getExtension(filePath: string): string {
  const name = getFileName(filePath);
  const dot = name.lastIndexOf(".");
  if (dot === -1) return "";
  return name.slice(dot + 1).toLowerCase();
}

export function isMarkdown(filePath: string): boolean {
  return MARKDOWN_EXTENSIONS.has(getExtension(filePath));
}

export async function getLanguageSupport(filePath: string): Promise<LanguageSupport | null> {
  const ext = getExtension(filePath);
  const loader = LANGUAGE_MAP[ext] ?? FILENAME_LANGUAGE_MAP[getFileName(filePath)];
  if (!loader) return null;
  return loader();
}
