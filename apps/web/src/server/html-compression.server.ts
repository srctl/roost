import { Duplex } from "node:stream";
import { constants, createGzip } from "node:zlib";

function acceptsGzip(value: string | null): boolean {
  let gzip: number | undefined;
  let wildcard = 0;
  for (const entry of value?.split(",") ?? []) {
    const [encoding, ...parameters] = entry.trim().toLowerCase().split(";");
    if (encoding?.trim() !== "gzip" && encoding?.trim() !== "*") continue;
    const qualityParameter = parameters.find((part) => /^\s*q\s*=/.test(part));
    const qualityValue = qualityParameter?.split("=")[1]?.trim();
    let quality = 1;
    if (qualityValue !== undefined) {
      quality = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(qualityValue)
        ? Number(qualityValue)
        : 0;
    }
    if (encoding.trim() === "gzip") gzip = quality;
    else wildcard = quality;
  }
  return (gzip ?? wildcard) > 0;
}

export function compressHtml(request: Request, response: Response): Response {
  if (
    request.method === "HEAD" ||
    !response.body ||
    response.status === 206 ||
    response.headers.has("Content-Range") ||
    response.headers.has("Content-Encoding") ||
    response.headers
      .get("Content-Type")
      ?.split(";")[0]
      ?.trim()
      .toLowerCase() !== "text/html" ||
    /(?:^|,)\s*no-transform\s*(?:,|$)/i.test(
      response.headers.get("Cache-Control") ?? "",
    )
  ) {
    return response;
  }

  const headers = new Headers(response.headers);
  const vary = headers.get("Vary");
  if (
    !vary
      ?.split(",")
      .some((name) => /^(?:accept-encoding|\*)$/i.test(name.trim()))
  ) {
    headers.set("Vary", vary ? `${vary}, Accept-Encoding` : "Accept-Encoding");
  }
  let body = response.body;
  if (acceptsGzip(request.headers.get("Accept-Encoding"))) {
    headers.set("Content-Encoding", "gzip");
    headers.delete("Content-Length");
    const etag = headers.get("ETag");
    if (etag && !etag.startsWith("W/")) headers.set("ETag", `W/${etag}`);
    // Flush each SSR chunk so compression does not delay the initial HTML shell.
    body = body.pipeThrough(
      // Node and DOM declare different types for the same native Web Streams.
      Duplex.toWeb(
        createGzip({ flush: constants.Z_SYNC_FLUSH }),
      ) as unknown as ReadableWritablePair<
        Uint8Array<ArrayBuffer>,
        Uint8Array<ArrayBuffer>
      >,
    );
  }
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
