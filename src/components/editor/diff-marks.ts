import { Mark } from "@tiptap/core";

/**
 * Two marks for the version preview only: text a version added and text it
 * removed. They never reach a live document or the serializer; the preview
 * editor is read-only and built fresh from a diff.
 */
export const DIFF_INSERT = "diffInsert";
export const DIFF_DELETE = "diffDelete";

export const DiffInsert = Mark.create({
  name: DIFF_INSERT,
  excludes: DIFF_DELETE,
  parseHTML() {
    return [{ tag: 'span[data-diff="insert"]' }];
  },
  renderHTML() {
    return ["span", { "data-diff": "insert" }, 0];
  },
});

export const DiffDelete = Mark.create({
  name: DIFF_DELETE,
  excludes: DIFF_INSERT,
  parseHTML() {
    return [{ tag: 'span[data-diff="delete"]' }];
  },
  renderHTML() {
    return ["span", { "data-diff": "delete" }, 0];
  },
});

export const diffMarkExtensions = [DiffInsert, DiffDelete];
