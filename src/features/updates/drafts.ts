import { type FileAttachment, MAX_FILE_BYTES } from "../chat/files";

const prefix = "roost-composer-draft-v2:";
function tab() {
  let value = sessionStorage.getItem("roost-draft-tab");
  if (!value) {
    value = crypto.randomUUID();
    sessionStorage.setItem("roost-draft-tab", value);
  }
  return value;
}
export function readDraft(
  agentId: string,
): { text: string; files: FileAttachment[] } | null {
  try {
    const validFile = (file: FileAttachment | null) =>
      file &&
      typeof file.id === "string" &&
      /^[a-f0-9-]{36}$/.test(file.id) &&
      typeof file.name === "string" &&
      file.name.length <= 1000 &&
      typeof file.mimeType === "string" &&
      file.mimeType.length <= 256 &&
      ["attachment", "artifact"].includes(file.kind) &&
      Number.isSafeInteger(file.size) &&
      file.size >= 0 &&
      file.size <= MAX_FILE_BYTES &&
      file.url === `/api/files?agentId=${agentId}&id=${file.id}`;
    const own = localStorage.getItem(`${prefix}${agentId}:${tab()}`);
    const entries = own
      ? [own]
      : Object.keys(localStorage)
          .filter((key) => key.startsWith(`${prefix}${agentId}:`))
          .map((key) => localStorage.getItem(key)!);
    const values = entries
      .map((value) => JSON.parse(value))
      .filter(
        (value) =>
          typeof value.text === "string" &&
          value.text.length < 1024 * 1024 &&
          Array.isArray(value.files) &&
          value.files.length <= 5 &&
          value.files.every(validFile),
      )
      .sort((a, b) => b.updatedAt - a.updatedAt);
    return values[0] ?? null;
  } catch {
    return null;
  }
}
export function saveDraft(
  agentId: string,
  text: string,
  files: readonly FileAttachment[],
) {
  const value = JSON.stringify({ text, files, updatedAt: Date.now() });
  if (value.length > 2 * 1024 * 1024)
    throw new Error("Draft exceeds local storage limit.");
  const key = `${prefix}${agentId}:${tab()}`;
  // Empty drafts are tombstones for this tab, so reload cannot revive another
  // tab's already-sent draft. Other tabs' independent drafts are preserved.
  localStorage.setItem(key, value);
}
