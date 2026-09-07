import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { Schema } from "effect";
import {
  type FileAttachment,
  MAX_ATTACHMENTS,
  MAX_FILE_BYTES,
} from "../../features/chat/files";
import type { Message } from "../../features/chat/schema";
import { AgentStoreError, withAgentStore } from "../agents/store.server";
import { requireAgent } from "../automations/store.server";
import { assertAvailable } from "../maintenance.server";
import { putMessage } from "../runs/timeline.server";
import { writeTransaction } from "../transaction.server";

export type StoredFile = Omit<FileAttachment, "url"> & {
  agentId: string;
  runId: string | null;
  createdAt: number;
};

export function fileMetadata(file: StoredFile): FileAttachment {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    size: file.size,
    kind: file.kind,
    url: `/api/files?agentId=${file.agentId}&id=${file.id}`,
  };
}

function filename(name: string) {
  const clean = basename(name.replaceAll("\\", "/"))
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Strip control characters from uploaded filenames.
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  if (!clean || clean === "." || clean === ".." || clean.length > 200)
    throw new AgentStoreError({
      message: "Choose a filename of 1–200 characters.",
    });
  return clean;
}

function storagePath(directory: string, agentId: string, id: string) {
  Schema.decodeUnknownSync(Schema.UUID)(agentId);
  Schema.decodeUnknownSync(Schema.UUID)(id);
  return join(directory, "files", agentId, id);
}

function storeFile(
  db: DatabaseSync,
  directory: string,
  input: {
    agentId: string;
    runId: string | null;
    name: string;
    mimeType: string;
    kind: StoredFile["kind"];
    bytes: Uint8Array;
  },
) {
  assertAvailable(db);
  requireAgent(db, input.agentId);
  if (input.bytes.byteLength > MAX_FILE_BYTES)
    throw new AgentStoreError({ message: "Files must be 20 MB or smaller." });
  const file: StoredFile = {
    id: randomUUID(),
    agentId: input.agentId,
    runId: input.runId,
    name: filename(input.name),
    mimeType: /^[\w.+-]+\/[\w.+-]+$/.test(input.mimeType)
      ? input.mimeType
      : "application/octet-stream",
    size: input.bytes.byteLength,
    kind: input.kind,
    createdAt: Date.now(),
  };
  const path = storagePath(directory, file.agentId, file.id);
  mkdirSync(join(directory, "files", file.agentId), {
    recursive: true,
    mode: 0o700,
  });
  writeFileSync(path, input.bytes, { flag: "wx", mode: 0o400 });
  try {
    db.prepare(
      "INSERT INTO files (id,agentId,runId,name,mimeType,size,kind,createdAt) VALUES (?,?,?,?,?,?,?,?)",
    ).run(
      file.id,
      file.agentId,
      file.runId,
      file.name,
      file.mimeType,
      file.size,
      file.kind,
      file.createdAt,
    );
  } catch (error) {
    unlinkSync(path);
    throw error;
  }
  return file;
}

export const uploadAttachment = (input: {
  agentId: string;
  name: string;
  mimeType: string;
  bytes: Uint8Array;
}) =>
  withAgentStore((db, directory) =>
    fileMetadata(
      storeFile(db, directory, { ...input, runId: null, kind: "attachment" }),
    ),
  );

export function linkAttachments(
  db: DatabaseSync,
  agentId: string,
  runId: string,
  ids: readonly string[] = [],
) {
  if (ids.length > MAX_ATTACHMENTS || new Set(ids).size !== ids.length)
    throw new AgentStoreError({ message: "Attach up to five distinct files." });
  return ids.map((id) => {
    const file = db
      .prepare(
        "SELECT * FROM files WHERE id=? AND agentId=? AND kind='attachment'",
      )
      .get(id, agentId) as StoredFile | undefined;
    if (!file || (file.runId && file.runId !== runId))
      throw new AgentStoreError({
        message: "An attachment is unavailable. Attach it again.",
      });
    db.prepare("UPDATE files SET runId=? WHERE id=?").run(runId, id);
    return fileMetadata(file);
  });
}

export function readRunFiles(
  db: DatabaseSync,
  agentId: string,
  runId: string,
  kind: StoredFile["kind"],
) {
  return db
    .prepare(
      "SELECT * FROM files WHERE agentId=? AND runId=? AND kind=? ORDER BY createdAt,id",
    )
    .all(agentId, runId, kind) as StoredFile[];
}

// Keep immutable user text and attachment metadata when Codex returns its expanded
// text input (which includes private local paths) as conversation history.
export const restoreAttachmentMessages = (
  agentId: string,
  messages: readonly Message[],
) =>
  withAgentStore((db) =>
    messages.map((message) => {
      if (message.role !== "user") return message;
      const files = readRunFiles(db, agentId, message.id, "attachment");
      if (!files.length) return message;
      const run = db
        .prepare("SELECT prompt FROM runs WHERE id=? AND agentId=?")
        .get(message.id, agentId);
      return {
        ...message,
        text: run ? String(run.prompt) : message.text,
        files: files.map(fileMetadata),
      };
    }),
  );

export const readRunAttachments = (agentId: string, runId: string) =>
  withAgentStore((db, directory) =>
    readRunFiles(db, agentId, runId, "attachment").map((file) => ({
      ...fileMetadata(file),
      path: storagePath(directory, agentId, file.id),
    })),
  );

function readBoundedFile(path: string) {
  const handle = openSync(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = fstatSync(handle);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES)
      throw new AgentStoreError({
        message: "Choose a regular file of 20 MB or smaller.",
      });
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(
        handle,
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (!count)
        throw new AgentStoreError({
          message: "The file changed while it was being read. Try again.",
        });
      offset += count;
    }
    const after = fstatSync(handle);
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs)
      throw new AgentStoreError({
        message: "The file changed while it was being read. Try again.",
      });
    return bytes;
  } finally {
    closeSync(handle);
  }
}

export const downloadFile = (agentId: string, id: string) =>
  withAgentStore((db, directory) => {
    assertAvailable(db);
    requireAgent(db, agentId);
    const file = db
      .prepare("SELECT * FROM files WHERE id=? AND agentId=?")
      .get(id, agentId) as StoredFile | undefined;
    if (!file) throw new AgentStoreError({ message: "File not found." });
    return {
      file: fileMetadata(file),
      bytes: readBoundedFile(storagePath(directory, agentId, id)),
    };
  });

const mimeTypes: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".json": "application/json",
  ".html": "text/html",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".zip": "application/zip",
};

export const publishArtifact = (
  agentId: string,
  runId: string,
  input: { path: string; name?: string },
) =>
  withAgentStore((db, directory) => {
    assertAvailable(db);
    requireAgent(db, agentId);
    if (
      !db
        .prepare(
          "SELECT id FROM runs WHERE id=? AND agentId=? AND status='running' AND cancelRequested=0",
        )
        .get(runId, agentId)
    )
      throw new AgentStoreError({
        message: "Files can only be published during an active run.",
      });
    const workspace = realpathSync(join(directory, "workspaces", agentId));
    const path = resolve(workspace, input.path);
    const local = relative(workspace, path);
    if (
      !local ||
      local === ".." ||
      local.startsWith(`..${sep}`) ||
      isAbsolute(local)
    )
      throw new AgentStoreError({
        message: "Choose a file inside this agent's workspace.",
      });
    let current = workspace;
    for (const part of local.split(sep)) {
      current = join(current, part);
      if (lstatSync(current).isSymbolicLink())
        throw new AgentStoreError({
          message: "Publish a regular workspace file, not a symbolic link.",
        });
    }
    if (realpathSync(path) !== path)
      throw new AgentStoreError({
        message: "Choose a file inside this agent's workspace.",
      });
    const name = filename(input.name ?? basename(path));
    const bytes = readBoundedFile(path);
    let saved: StoredFile | undefined;
    try {
      return writeTransaction(db, () => {
        saved = storeFile(db, directory, {
          agentId,
          runId,
          name,
          bytes,
          mimeType:
            mimeTypes[extname(name).toLowerCase()] ??
            "application/octet-stream",
          kind: "artifact",
        });
        const file = fileMetadata(saved);
        putMessage(db, agentId, {
          id: `artifact:${file.id}`,
          role: "assistant",
          text: "",
          files: [file],
        });
        return file;
      });
    } catch (error) {
      // The SQLite rollback also needs to remove this new immutable snapshot.
      // Never remove the original workspace file or any earlier publication.
      if (saved) unlinkSync(storagePath(directory, agentId, saved.id));
      throw error;
    }
  });
