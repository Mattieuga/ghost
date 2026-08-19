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
