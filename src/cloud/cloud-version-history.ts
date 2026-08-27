import type { SupabaseClient } from "@supabase/supabase-js";

export const AUTOMATIC_VERSION_IDLE_MS = 30_000;
export const AUTOMATIC_VERSION_MIN_INTERVAL_MS = 5 * 60_000;
export const AUTOMATIC_VERSION_MAX_INTERVAL_MS = 15 * 60_000;
export const AUTOMATIC_VERSION_LIMIT = 50;

export type CloudDocumentVersionReason = "automatic" | "restore" | "restore_backup";

export interface CloudDocumentVersion {
  id: number;
  document_id: string;
  author_id: string | null;
  reason: CloudDocumentVersionReason;
  restored_from_version_id: number | null;
  markdown_snapshot: string;
  yjs_snapshot?: string;
  created_at: string;
}

export interface CreateCloudDocumentVersionInput {
  documentId: string;
  markdownSnapshot: string;
  yjsSnapshot: string;
  reason: CloudDocumentVersionReason;
  restoredFromVersionId?: number | null;
}

function throwVersionError(context: string, error: { message: string } | null): void {
  if (error) throw new Error(`${context}: ${error.message}`);
}

export async function listCloudDocumentVersions(
  client: SupabaseClient,
  documentId: string,
): Promise<CloudDocumentVersion[]> {
  const { data, error } = await client
    .from("cloud_document_versions")
    .select(
      "id, document_id, author_id, reason, restored_from_version_id, markdown_snapshot, created_at",
    )
    .eq("document_id", documentId)
    .order("created_at", { ascending: false })
    .limit(AUTOMATIC_VERSION_LIMIT);
  throwVersionError("Could not load document history", error);
  return (data ?? []) as CloudDocumentVersion[];
}

export async function createCloudDocumentVersion(
  client: SupabaseClient,
  input: CreateCloudDocumentVersionInput,
): Promise<CloudDocumentVersion> {
  const { data, error } = await client.rpc("cloud_create_document_version", {
    target_document_id: input.documentId,
    snapshot_markdown: input.markdownSnapshot,
    snapshot_yjs: input.yjsSnapshot,
    version_reason: input.reason,
    target_restored_from_version_id: input.restoredFromVersionId ?? null,
  });
  throwVersionError("Could not save document history", error);
  if (!data) throw new Error("Supabase did not return the saved document version");
  return data as CloudDocumentVersion;
}

export function automaticVersionDelay(
  lastVersionCreatedAt: string | null,
  now = Date.now(),
): number {
  if (!lastVersionCreatedAt) return AUTOMATIC_VERSION_IDLE_MS;
  const elapsed = now - new Date(lastVersionCreatedAt).getTime();
  return Math.max(AUTOMATIC_VERSION_IDLE_MS, AUTOMATIC_VERSION_MIN_INTERVAL_MS - elapsed);
}

export function automaticVersionMaximumDelay(
  lastVersionCreatedAt: string | null,
  now = Date.now(),
): number {
  if (!lastVersionCreatedAt) return AUTOMATIC_VERSION_IDLE_MS;
  const elapsed = now - new Date(lastVersionCreatedAt).getTime();
  return Math.max(AUTOMATIC_VERSION_IDLE_MS, AUTOMATIC_VERSION_MAX_INTERVAL_MS - elapsed);
}

export function formatCloudVersionReason(reason: CloudDocumentVersionReason): string {
  if (reason === "restore") return "Restored version";
  if (reason === "restore_backup") return "Before restore";
  return "Automatic version";
}
