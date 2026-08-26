export interface LocalDocumentRef {
  kind: "local";
  path: string;
}

export interface CloudDocumentRef {
  kind: "cloud";
  documentId: string;
}

export type DocumentRef = LocalDocumentRef | CloudDocumentRef;

export type DocumentPersistence = "versioned-file" | "collaborative";
export type DocumentSubscription = "filesystem" | "collaboration";
export type DocumentAssets = "companion-directory" | "private-cloud";

/**
 * Source behavior is explicit so source-agnostic UI can hide impossible
 * actions without inventing filesystem paths for cloud documents.
 */
export interface DocumentSourceCapabilities {
  load: true;
  persistence: DocumentPersistence;
  subscription: DocumentSubscription;
  rename: boolean;
  move: boolean;
  delete: boolean;
  revealInFinder: boolean;
  openExternally: boolean;
  sharing: boolean;
  assets: DocumentAssets;
}

export const LOCAL_DOCUMENT_CAPABILITIES = {
  load: true,
  persistence: "versioned-file",
  subscription: "filesystem",
  rename: true,
  move: true,
  delete: true,
  revealInFinder: true,
  openExternally: true,
  sharing: false,
  assets: "companion-directory",
} as const satisfies DocumentSourceCapabilities;

export const CLOUD_DOCUMENT_CAPABILITIES = {
  load: true,
  persistence: "collaborative",
  subscription: "collaboration",
  rename: true,
  move: true,
  delete: true,
  revealInFinder: false,
  openExternally: false,
  sharing: true,
  assets: "private-cloud",
} as const satisfies DocumentSourceCapabilities;

export function localDocumentRef(path: string): LocalDocumentRef {
  if (!path) throw new Error("A local document path is required");
  return { kind: "local", path };
}

export function cloudDocumentRef(documentId: string): CloudDocumentRef {
  if (!documentId) throw new Error("A cloud document ID is required");
  return { kind: "cloud", documentId };
}

export function documentRefKey(ref: DocumentRef): string {
  switch (ref.kind) {
    case "local":
      return `local:${ref.path}`;
    case "cloud":
      return `cloud:${ref.documentId}`;
    default:
      return assertNever(ref);
  }
}

export function documentSourceCapabilities(
  ref: DocumentRef,
): DocumentSourceCapabilities {
  switch (ref.kind) {
    case "local":
      return LOCAL_DOCUMENT_CAPABILITIES;
    case "cloud":
      return CLOUD_DOCUMENT_CAPABILITIES;
    default:
      return assertNever(ref);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unknown document source: ${JSON.stringify(value)}`);
}
