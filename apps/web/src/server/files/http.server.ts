import { Effect, Schema } from "effect";
import { MAX_FILE_BYTES } from "../../features/chat/files";
import { AgentStoreError } from "../agents/store.server";
import { downloadFile, uploadAttachment } from "./store.server";

// Roost uses the same local/protected-proxy boundary as its other routes. Do not
// permit another website to upload files or cause the browser to download one.
export function sameOriginFileRequest(request: Request) {
  // Fetch Metadata is browser-controlled and stays correct behind an HTTPS
  // proxy whose upstream request URL may use HTTP.
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const expected = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  if (origin) return origin === expected;
  const referer = request.headers.get("referer");
  try {
    return !!referer && new URL(referer).origin === expected;
  } catch {
    return false;
  }
}

const ids = Schema.decodeUnknownSync(
  Schema.Struct({ agentId: Schema.UUID, id: Schema.UUID }),
);
const agentId = Schema.decodeUnknownSync(Schema.UUID);

export async function uploadFileRequest(request: Request) {
  if (!sameOriginFileRequest(request))
    return new Response("Forbidden", { status: 403 });
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data"))
    return Response.json(
      { error: "Choose a file to upload." },
      { status: 400 },
    );
  const maximum = MAX_FILE_BYTES + 64 * 1024;
  if (Number(request.headers.get("content-length")) > maximum)
    return Response.json(
      { error: "Files must be 20 MB or smaller." },
      { status: 413 },
    );
  // Bound the streamed body even when Content-Length is absent or dishonest.
  const reader = request.body?.getReader();
  if (!reader)
    return Response.json(
      { error: "Choose a file to upload." },
      { status: 400 },
    );
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        return Response.json(
          { error: "Files must be 20 MB or smaller." },
          { status: 413 },
        );
      }
      chunks.push(value);
    }
    const body = new Blob(chunks as BlobPart[]);
    const form = await new Response(body, {
      headers: { "content-type": request.headers.get("content-type")! },
    }).formData();
    const id = agentId(form.get("agentId"));
    const file = form.get("file");
    if (!(file instanceof File) || form.getAll("file").length !== 1)
      return Response.json(
        { error: "Choose one file to upload." },
        { status: 400 },
      );
    const result = await Effect.runPromise(
      uploadAttachment({
        agentId: id,
        name: file.name,
        mimeType: file.type,
        bytes: new Uint8Array(await file.arrayBuffer()),
      }),
    );
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(
      { error: "Could not upload this file. Check its size and try again." },
      { status: 400 },
    );
  } finally {
    reader.releaseLock();
  }
}

export async function downloadFileRequest(request: Request) {
  if (!sameOriginFileRequest(request))
    return new Response("Forbidden", { status: 403 });
  try {
    const input = ids(Object.fromEntries(new URL(request.url).searchParams));
    const { file, bytes } = await Effect.runPromise(
      downloadFile(input.agentId, input.id),
    );
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Length": String(file.size),
        "Content-Disposition": `attachment; filename="download${/\.[a-z0-9]{1,10}$/i.exec(file.name)?.[0] ?? ""}"; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16)}`)}`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Cross-Origin-Resource-Policy": "same-origin",
        "Content-Security-Policy": "sandbox",
      },
    });
  } catch (error) {
    return new Response(
      error instanceof AgentStoreError ? error.message : "File unavailable",
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }
}
