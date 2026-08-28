import type { Editor } from "@tiptap/core";
import { invoke } from "@tauri-apps/api/core";
import { writeHtml, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ResizableImage, handleImageFromPath } from "@/components/editor/image-extension";
import type { MarkdownEditorPlatformActions } from "@/components/editor/markdown-editor";

export const localMarkdownImageExtension = ResizableImage.configure({
  allowBase64: true,
});

export const tauriMarkdownEditorActions: MarkdownEditorPlatformActions = {
  openUrl: (url) => invoke("open_url", { url }),
  writeText,
  writeHtml,
  insertImage: async (editor: Editor) => {
    if (!window.__ghostActiveFile) return;
    const selected = await openDialog({
      multiple: false,
      title: "Select an image",
      filters: [{
        name: "Images",
        extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"],
      }],
    });
    if (!selected || typeof selected !== "string") return;
    const relativePath = await handleImageFromPath(selected);
    if (relativePath) editor.chain().focus().setImage({ src: relativePath }).run();
  },
};
