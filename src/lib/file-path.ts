import { SearchCursor } from "@codemirror/search";
import { Text } from "@codemirror/state";

/**
 * Map an open file through a file or containing-folder rename.
 * Returns null when the renamed path does not contain the open file.
 */
export function retargetPath(
  currentPath: string,
  oldPath: string,
  newPath: string,
): string | null {
  if (currentPath !== oldPath && !currentPath.startsWith(oldPath + "/")) {
    return null;
  }
  return newPath + currentPath.slice(oldPath.length);
}

function companionAssetsName(filePath: string): string {
  const name = filePath.split("/").pop() ?? filePath;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return `${stem}.assets`;
}

/** Mirror rename_file's companion asset reference rewrite for live editors. */
export function retargetCompanionAssetReferences(
  content: string,
  oldFilePath: string,
  newFilePath: string,
): string {
  const oldAssets = companionAssetsName(oldFilePath);
  const newAssets = companionAssetsName(newFilePath);
  if (oldAssets === newAssets) return content;
  return content.split(oldAssets).join(newAssets);
}

/** Retarget companion asset paths without flattening a CodeMirror document. */
export function retargetCompanionAssetDocument(
  document: Text,
  oldFilePath: string,
  newFilePath: string,
): Text {
  const oldAssets = companionAssetsName(oldFilePath);
  const newAssets = companionAssetsName(newFilePath);
  if (oldAssets === newAssets) return document;

  const matches: Array<{ from: number; to: number }> = [];
  const cursor = new SearchCursor(document, oldAssets);
  while (!cursor.next().done) matches.push(cursor.value);

  let result = document;
  const replacement = Text.of([newAssets]);
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const match = matches[index];
    result = result.replace(match.from, match.to, replacement);
  }
  return result;
}
