import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";

const ghostEditorTheme = EditorView.theme({
  "&": {
    backgroundColor: "var(--background)",
    color: "var(--card-foreground)",
    height: "100%",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-content": {
    padding: "3.5rem 45px 2.5rem 0",
    fontFamily: 'var(--editor-code-font, "JetBrains Mono"), "SF Mono", ui-monospace, monospace',
    fontSize: "14px",
    lineHeight: "22px",
    caretColor: "var(--ghost-amber)",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--ghost-amber)",
    borderLeftWidth: "2px",
  },
  ".cm-gutters": {
    backgroundColor: "var(--background)",
    color: "var(--ring)",
    border: "none",
    paddingLeft: "40px",
  },
  ".cm-gutter.cm-lineNumbers .cm-gutterElement": {
    padding: "0 8px 0 0",
    minWidth: "32px",
    fontSize: "13px",
    fontFamily: 'var(--editor-code-font, "JetBrains Mono"), "SF Mono", ui-monospace, monospace',
  },
  ".cm-gutter.cm-foldGutter .cm-gutterElement": {
    padding: "0 4px",
    color: "var(--ring)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "transparent",
    color: "var(--sidebar-primary)",
  },
  ".cm-activeLine": {
    backgroundColor: "color-mix(in srgb, var(--muted) 40%, transparent)",
  },
  ".cm-selectionBackground": {
    backgroundColor: "color-mix(in srgb, var(--ghost-amber) 20%, transparent) !important",
  },
  "&.cm-focused .cm-selectionBackground": {
    backgroundColor: "color-mix(in srgb, var(--ghost-amber) 25%, transparent) !important",
  },
  ".cm-searchMatch": {
    backgroundColor: "color-mix(in srgb, var(--ghost-amber) 30%, transparent)",
    borderRadius: "2px",
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "var(--ghost-amber)",
    color: "var(--background)",
    borderRadius: "2px",
  },
  ".cm-matchingBracket": {
    backgroundColor: "color-mix(in srgb, var(--ghost-amber) 25%, transparent)",
    color: "var(--ghost-amber)",
    outline: "none",
  },
  ".cm-nonmatchingBracket": {
    color: "var(--destructive)",
  },
  ".cm-foldPlaceholder": {
    backgroundColor: "var(--muted)",
    color: "var(--ring)",
    border: "none",
    padding: "0 6px",
    borderRadius: "4px",
  },
  ".cm-tooltip": {
    backgroundColor: "var(--popover)",
    color: "var(--popover-foreground)",
    border: "1px solid var(--border)",
    borderRadius: "6px",
  },
  ".cm-tooltip-autocomplete": {
    "& > ul > li": {
      padding: "4px 8px",
    },
    "& > ul > li[aria-selected]": {
      backgroundColor: "var(--accent)",
      color: "var(--accent-foreground)",
    },
  },
  ".cm-panels": {
    backgroundColor: "var(--background)",
    color: "var(--foreground)",
  },
  // Hide the default CM search panel — we use Ghost's SearchBar
  ".cm-panels .cm-search": {
    display: "none",
  },
  ".cm-scroller": {
    overflow: "auto",
  },
  // Syntax highlighting via CSS variables (adapts to theme)
  ".cmt-keyword": { color: "var(--code-keyword)" },
  ".cmt-name": { color: "var(--code-name)" },
  ".cmt-function": { color: "var(--code-function)" },
  ".cmt-constant": { color: "var(--code-constant)" },
  ".cmt-default": { color: "var(--code-default)" },
  ".cmt-type": { color: "var(--code-type)" },
  ".cmt-operator": { color: "var(--code-operator)" },
  ".cmt-comment": { color: "var(--code-comment)", fontStyle: "italic" },
  ".cmt-string": { color: "var(--code-string)" },
});

// Syntax colors are applied via CSS classes so they respond to theme changes.
// HighlightStyle.define only accepts static color strings, not CSS variables,
// so we use a classHighlightStyle and set the colors in the EditorView theme.
const ghostHighlightClasses = HighlightStyle.define([
  { tag: tags.keyword, class: "cmt-keyword" },
  { tag: [tags.name, tags.deleted, tags.character, tags.macroName], class: "cmt-name" },
  { tag: [tags.function(tags.variableName), tags.labelName], class: "cmt-function" },
  { tag: [tags.color, tags.constant(tags.name), tags.standard(tags.name)], class: "cmt-constant" },
  { tag: [tags.definition(tags.name), tags.separator], class: "cmt-default" },
  { tag: [tags.typeName, tags.className, tags.number, tags.changed, tags.annotation, tags.modifier, tags.self, tags.namespace], class: "cmt-type" },
  { tag: [tags.operator, tags.operatorKeyword, tags.url, tags.escape, tags.regexp, tags.link, tags.special(tags.string)], class: "cmt-operator" },
  { tag: [tags.meta, tags.comment], class: "cmt-comment" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.link, class: "cmt-function", textDecoration: "underline" },
  { tag: tags.heading, fontWeight: "bold", class: "cmt-name" },
  { tag: [tags.atom, tags.bool, tags.special(tags.variableName)], class: "cmt-constant" },
  { tag: [tags.processingInstruction, tags.string, tags.inserted], class: "cmt-string" },
  { tag: tags.invalid, class: "cmt-name" },
]);

export const ghostTheme = [ghostEditorTheme, syntaxHighlighting(ghostHighlightClasses)];
