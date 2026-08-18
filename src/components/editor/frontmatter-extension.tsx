import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/**
 * YAML frontmatter is deliberately kept as raw source. Ghost does not parse or
 * normalize it, so key order, comments, quoting, line endings, and delimiters
 * survive a Markdown round trip.
 */
function FrontmatterView({ node, updateAttributes, selected }: NodeViewProps) {
  const raw = String(node.attrs.raw ?? "---\n---");
  const [expanded, setExpanded] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!expanded || !textareaRef.current) return;
    const textarea = textareaRef.current;
    textarea.style.height = "0px";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [expanded, raw]);

  const lineCount = raw.split(/\r?\n/).length;

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
        <span className="ghost-frontmatter-count">{lineCount} lines</span>
      </button>
      {expanded && (
        <textarea
          ref={textareaRef}
          className="ghost-frontmatter-source"
          value={raw}
          spellCheck={false}
          aria-label="YAML frontmatter source"
          onChange={(event) => updateAttributes({ raw: event.target.value })}
          onKeyDown={(event) => event.stopPropagation()}
        />
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
