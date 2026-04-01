import Image from "@tiptap/extension-image";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { ResizableImageView } from "./resizable-image";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { invoke } from "@tauri-apps/api/core";

/** Escape HTML special characters for safe attribute interpolation */
function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Get the directory of the currently active file.
 * Falls back to empty string if not available.
 */
export function getActiveFileDir(): string {
  const activeFile = window.__ghostActiveFile;
  if (!activeFile) return "";
  const lastSlash = activeFile.lastIndexOf("/");
  return lastSlash >= 0 ? activeFile.substring(0, lastSlash) : "";
}

async function handleImageFile(file: File): Promise<{ src: string } | null> {
  const dir = getActiveFileDir();
  if (!dir) return null;

  const buffer = await file.arrayBuffer();
  const data = Array.from(new Uint8Array(buffer));
  const rawName = file.name || `image-${Date.now()}.png`;
  const filename = rawName.replace(/\s+/g, "-");

  const relativePath = await invoke<string>("save_image", {
    dir,
    filename,
    data,
  });

  return { src: relativePath };
}

export const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el) => {
          const w = el.getAttribute("width");
          return w ? Number(w) : null;
        },
        renderHTML: (attrs) => {
          if (!attrs.width) return {};
          return { width: attrs.width };
        },
      },
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          const { src, alt, title, width } = node.attrs;
          if (width) {
            const safeSrc = escapeAttr(src || "");
            const altAttr = alt ? ` alt="${escapeAttr(alt)}"` : "";
            const titleAttr = title ? ` title="${escapeAttr(title)}"` : "";
            state.write(`<img src="${safeSrc}"${altAttr}${titleAttr} width="${Math.round(width)}">\n\n`);
          } else {
            state.write(`![${state.esc(alt || "")}](${src}${title ? ` "${state.esc(title)}"` : ""})\n\n`);
          }
        },
        parse: {
          // handled by markdown-it (parses both ![](src) and <img> tags)
        },
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView);
  },

  addProseMirrorPlugins() {
    const plugins = this.parent?.() ?? [];

    plugins.push(
      new Plugin({
        key: new PluginKey("imagePasteDrop"),
        props: {
          handlePaste: (view, event) => {
            const items = event.clipboardData?.items;
            if (!items) return false;

            for (const item of items) {
              if (item.type.startsWith("image/")) {
                event.preventDefault();
                const file = item.getAsFile();
                if (!file) continue;

                handleImageFile(file).then((result) => {
                  if (!result) return;
                  // Use fresh state for insertion
                  const { state } = view;
                  const node = state.schema.nodes.image.create({
                    src: result.src,
                  });
                  const tr = state.tr.replaceSelectionWith(node);
                  view.dispatch(tr);
                });
                return true;
              }
            }
            return false;
          },

          handleDrop: (view, event) => {
            const files = event.dataTransfer?.files;
            if (!files || files.length === 0) return false;

            const imageFiles = Array.from(files).filter((f) =>
              f.type.startsWith("image/")
            );
            if (imageFiles.length === 0) return false;

            event.preventDefault();
            const coordinates = view.posAtCoords({
              left: event.clientX,
              top: event.clientY,
            });
            // Capture position synchronously
            const dropPos = coordinates?.pos ?? view.state.selection.from;

            for (const file of imageFiles) {
              handleImageFile(file).then((result) => {
                if (!result) return;
                const { state } = view;
                const node = state.schema.nodes.image.create({
                  src: result.src,
                });
                // Use fresh state for insertion
                const tr = state.tr.insert(Math.min(dropPos, state.doc.content.size), node);
                view.dispatch(tr);
              });
            }
            return true;
          },
        },
      }),

      // Clean up .images/ files when image nodes are deleted
      new Plugin({
        key: new PluginKey("imageCleanup"),
        state: {
          init(_config, state) {
            // Collect initial set of image srcs
            const srcs = new Set<string>();
            state.doc.descendants((node) => {
              if (node.type.name === "image" && node.attrs.src?.startsWith(".images/")) {
                srcs.add(node.attrs.src);
              }
            });
            return srcs;
          },
          apply(tr, oldSrcs: Set<string>, _oldState, newState) {
            if (!tr.docChanged) return oldSrcs;
            const newSrcs = new Set<string>();
            newState.doc.descendants((node) => {
              if (node.type.name === "image" && node.attrs.src?.startsWith(".images/")) {
                newSrcs.add(node.attrs.src);
              }
            });
            // Delete files for removed images (fire-and-forget, outside transaction)
            for (const src of oldSrcs) {
              if (!newSrcs.has(src)) {
                const dir = getActiveFileDir();
                if (dir) {
                  invoke("delete_file", { path: `${dir}/${src}` }).catch(() => {});
                }
              }
            }
            return newSrcs;
          },
        },
      })
    );

    return plugins;
  },
});
