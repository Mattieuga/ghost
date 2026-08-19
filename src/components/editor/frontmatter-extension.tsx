import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { parseFrontmatterSource, replaceFrontmatterYaml } from "./frontmatter";

/**
 * YAML frontmatter is deliberately kept as raw source. Ghost does not parse or
 * normalize it, so key order, comments, quoting, line endings, and delimiters
 * survive a Markdown round trip.
 */
function FrontmatterView({ node, updateAttributes, selected }: NodeViewProps) {
  const raw = String(node.attrs.raw ?? "---\n---");
  const source = parseFrontmatterSource(raw) ?? parseFrontmatterSource("---\n---")!;
  const [expanded, setExpanded] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingSelection = useRef<{
    start: number;
    end: number;
    direction: "forward" | "backward" | "none";
  } | null>(null);

  // Updating the raw node attribute causes React to reapply the controlled
  // textarea value. Browsers move the caret to the end when that happens, so
  // restore the selection synchronously after Tiptap has rendered the update.
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    const selection = pendingSelection.current;
    if (!textarea || !selection || document.activeElement !== textarea) return;
    textarea.setSelectionRange(selection.start, selection.end, selection.direction);
    pendingSelection.current = null;
  }, [source.yaml]);

  useEffect(() => {
    if (!expanded || !textareaRef.current) return;
    const textarea = textareaRef.current;
    textarea.style.height = "0px";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [expanded, source.yaml]);

  const lineCount = source.yaml ? source.yaml.split(/\r?\n/).length : 0;

  return (
    <NodeViewWrapper
      className={`ghost-frontmatter ${selected ? "selected" : ""}`}
      data-frontmatter-node
      contentEditable={false}
    >
      <button
        type="button"
        className="ghost-frontmatter-header"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>Frontmatter</span>
        <span className="ghost-frontmatter-count">
          {lineCount} YAML {lineCount === 1 ? "line" : "lines"}
        </span>
      </button>
      {expanded && (
        <div className="ghost-frontmatter-source">
          <div className="ghost-frontmatter-delimiter" aria-hidden="true">
            {source.opening.replace(/^\uFEFF/, "")}
          </div>
          <textarea
            ref={textareaRef}
            className="ghost-frontmatter-yaml"
            value={source.yaml}
            spellCheck={false}
            aria-label="YAML frontmatter content"
            onChange={(event) => {
              const textarea = event.currentTarget;
              pendingSelection.current = {
                start: textarea.selectionStart,
                end: textarea.selectionEnd,
                direction: textarea.selectionDirection,
              };
              updateAttributes({ raw: replaceFrontmatterYaml(raw, textarea.value) });
            }}
            onKeyDown={(event) => event.stopPropagation()}
          />
          <div className="ghost-frontmatter-delimiter" aria-hidden="true">
            {source.closing}
          </div>
        </div>
      )}
    </NodeViewWrapper>
  );
}

export const Frontmatter = Node.create({
  name: "frontmatter",
  group: "block",
  atom: true,
  isolating: true,
  selectable: true,

  addAttributes() {
    return {
      raw: { default: "---\n---" },
    };
  },

  parseHTML() {
    return [
      {
        tag: "pre[data-frontmatter]",
        getAttrs: (element) => ({ raw: (element as HTMLElement).textContent ?? "---\n---" }),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "pre",
      mergeAttributes(HTMLAttributes, { "data-frontmatter": "" }),
      String(node.attrs.raw ?? "---\n---"),
    ];
  },

  renderMarkdown(node) {
    return String(node.attrs?.raw ?? "---\n---");
  },

  addNodeView() {
    return ReactNodeViewRenderer(FrontmatterView);
  },
});
