export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_ATTACHMENTS = 5;

export type FileAttachment = {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly size: number;
  readonly kind: "attachment" | "artifact";
  readonly url: string;
};

export function formatFileSize(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.ceil(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Attachment metadata can also arrive from restored drafts or model output.
// Only fetch the authenticated file route; never turn it into a remote beacon.
export function safeAttachmentUrl(file: FileAttachment): string | undefined {
  if (typeof file.url !== "string" || !file.url.startsWith("/api/files?"))
    return undefined;
  try {
    const url = new URL(file.url, "https://roost.invalid");
    const id = url.searchParams.get("id");
    const agentId = url.searchParams.get("agentId");
    const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
    if (id !== file.id || !uuid.test(id) || !agentId || !uuid.test(agentId))
      return undefined;
    return `/api/files?agentId=${agentId}&id=${id}`;
  } catch {
    return undefined;
  }
}
