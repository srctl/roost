import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { decodeHTML } from "entities";
import { XMLParser, XMLValidator } from "fast-xml-parser";

export type FeedCandidate = {
  externalId: string;
  title: string;
  summary: string;
  body: string;
  url: string;
  imageUrl: string | null;
  sourceName: string;
  sourceUrl: string;
  publishedAt: number;
  topics: string[];
};

export type FeedSourceInput = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  etag?: string | null;
  lastModified?: string | null;
};

type Address = { address: string; family: number };
export type FeedFetchOptions = {
  /** Test transport; production uses a socket pinned to a verified public IP. */
  fetch?: typeof fetch;
  lookup?: (hostname: string) => Promise<Address[]>;
  now?: number;
  timeoutMs?: number;
  maxBytes?: number;
  maxItems?: number;
};

export class FeedSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeedSourceError";
  }
}

/** Fail closed for special-purpose ranges, including IPv4-mapped IPv6. */
export function isPublicFeedAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a = -1, b = -1, c = -1] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (version !== 6) return false;
  // Public unicast is 2000::/3. Reject transition, benchmark and documentation space.
  const normalized = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  const [first = -1, second = -1] = normalized
    .split(":")
    .map((part) => Number.parseInt(part || "0", 16));
  return (
    first >= 0x2000 &&
    first <= 0x3fff &&
    first !== 0x2002 &&
    first !== 0x3fff &&
    !(first === 0x2001 && (second <= 0x1ff || second === 0xdb8))
  );
}

/** Used for source URLs and externally displayed links, never permits credentials. */
export function safeFeedUrl(value: string, base?: string): string | null {
  try {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Reject URL controls that can obscure the destination.
    if (!value || /[\u0000-\u001f\u007f]/.test(value)) return null;
    const url = new URL(value.trim(), base);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.port
    )
      return null;
    const hostname = url.hostname
      .toLowerCase()
      .replace(/^\[|\]$/g, "")
      .replace(/\.$/, "");
    if (
      !hostname ||
      hostname === "localhost" ||
      (!hostname.includes(".") && !isIP(hostname)) ||
      /\.(localhost|local|internal|home|lan|test|invalid)$/.test(hostname)
    )
      return null;
    if (isIP(hostname) && !isPublicFeedAddress(hostname)) return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function sourceUrl(value: string): URL {
  const safe = safeFeedUrl(value);
  if (!safe)
    throw new FeedSourceError(
      "Use a public HTTP or HTTPS feed URL without credentials or a custom port.",
    );
  return new URL(safe);
}

async function publicAddress(
  url: URL,
  options: FeedFetchOptions,
  signal: AbortSignal,
): Promise<Address> {
  const hostname = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await (options.lookup ?? ((host) => dnsLookup(host, { all: true })))(
        hostname,
      );
  signal.throwIfAborted();
  if (
    !addresses.length ||
    addresses.some(({ address }) => !isPublicFeedAddress(address))
  ) {
    throw new FeedSourceError(
      "The feed must resolve only to public internet addresses.",
    );
  }
  return addresses[0]!;
}

function pinnedFetch(
  url: URL,
  address: Address,
  headers: Headers,
  signal: AbortSignal,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      url,
      {
        headers: Object.fromEntries(headers),
        signal,
        // The hostname remains intact for Host and TLS verification; DNS cannot rebind between checks.
        lookup: (_hostname, _options, callback) =>
          callback(null, address.address, address.family),
        family: address.family,
        agent: false,
      },
      (incoming) => {
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (value !== undefined)
            responseHeaders.set(
              name,
              Array.isArray(value) ? value.join(", ") : value,
            );
        }
        const status = incoming.statusCode ?? 502;
        if (status === 304 || status === 204 || status === 205) {
          incoming.resume();
          resolve(new Response(null, { status, headers: responseHeaders }));
          return;
        }
        const encoding = responseHeaders.get("content-encoding")?.toLowerCase();
        let body: Readable = incoming;
        if (encoding && encoding !== "identity") {
          const decoder =
            encoding === "gzip"
              ? createGunzip()
              : encoding === "deflate"
                ? createInflate()
                : encoding === "br"
                  ? createBrotliDecompress()
                  : null;
          if (!decoder) {
            incoming.destroy();
            reject(
              new FeedSourceError(
                "The feed uses an unsupported content encoding.",
              ),
            );
            return;
          }
          incoming.on("error", (error) => decoder.destroy(error));
          decoder.on("close", () => incoming.destroy());
          body = incoming.pipe(decoder);
          responseHeaders.delete("content-length");
          responseHeaders.delete("content-encoding");
        }
        resolve(
          new Response(Readable.toWeb(body) as ReadableStream<Uint8Array>, {
            status,
            headers: responseHeaders,
          }),
        );
      },
    );
    request.on("error", reject);
    request.end();
  });
}

async function readBounded(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<string> {
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body?.cancel();
    throw new FeedSourceError(
      "The feed is larger than the supported size limit.",
    );
  }
  if (!response.body)
    throw new FeedSourceError("The feed returned an empty response.");
  const reader = response.body.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new FeedSourceError(
          "The feed is larger than the supported size limit.",
        );
      }
      chunks.push(value);
    }
    signal.throwIfAborted();
    const encoding =
      response.headers
        .get("content-type")
        ?.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1] ?? "utf-8";
    return new TextDecoder(encoding).decode(Buffer.concat(chunks));
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

export function feedHtmlToText(html: string, maxLength = 12_000): string {
  return (
    decodeHTML(
      html
        .replace(/<!--[\s\S]*?(?:-->|$)/g, " ")
        .replace(
          /<(script|style|iframe|object|svg)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi,
          " ",
        )
        .replace(/<[^>]*>/g, " "),
    )
      // biome-ignore lint/suspicious/noControlCharactersInRegex: Remove nonprinting control characters from untrusted text.
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxLength)
  );
}

type XmlNode = Record<string, unknown>;
const record = (value: unknown): XmlNode =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as XmlNode)
    : {};
const list = (value: unknown): unknown[] =>
  value === undefined || value === null
    ? []
    : Array.isArray(value)
      ? value
      : [value];
const scalar = (value: unknown): string =>
  typeof value === "string" || typeof value === "number"
    ? String(value)
    : Array.isArray(value)
      ? scalar(value[0])
      : scalar(record(value)["#text"] ?? "");

function contentText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number")
    return String(value);
  if (Array.isArray(value)) return value.map(contentText).join(" ");
  return Object.entries(record(value))
    .filter(
      ([key]) =>
        !key.startsWith("@_") &&
        !["script", "style", "svg", "iframe"].includes(key),
    )
    .map(([, child]) => contentText(child))
    .join(" ");
}

function imageFromStructuredContent(
  value: unknown,
  base: string,
): string | null {
  for (const node of list(value)) {
    for (const [name, child] of Object.entries(record(node))) {
      const localName = name.split(":").at(-1);
      if (
        ["script", "style", "iframe", "object", "svg"].includes(localName ?? "")
      )
        continue;
      if (localName === "img") {
        for (const image of list(child)) {
          const url = safeFeedUrl(scalar(record(image)["@_src"]), base);
          if (url) return url;
        }
      }
      if (!name.startsWith("@_")) {
        const nested = imageFromStructuredContent(child, base);
        if (nested) return nested;
      }
    }
  }
  return null;
}

function imageFromEntry(
  item: XmlNode,
  html: string,
  base: string,
): string | null {
  const group = record(item["media:group"]);
  const media = [
    ...list(item["media:content"]),
    ...list(group["media:content"]),
    ...list(item["media:thumbnail"]),
    ...list(group["media:thumbnail"]),
    ...list(item.enclosure),
  ];
  for (const entry of media) {
    const value = record(entry);
    const type = scalar(value["@_type"]);
    const medium = scalar(value["@_medium"]);
    const candidate = scalar(value["@_url"]);
    if ((type && !type.startsWith("image/")) || (medium && medium !== "image"))
      continue;
    const url = safeFeedUrl(candidate, base);
    if (url) return url;
  }
  for (const link of list(item.link ?? item["atom:link"])) {
    const value = record(link);
    if (
      value["@_rel"] !== "enclosure" ||
      !scalar(value["@_type"]).startsWith("image/")
    )
      continue;
    const url = safeFeedUrl(scalar(value["@_href"]), base);
    if (url) return url;
  }
  const content = item.content ?? item["atom:content"];
  const summary = item.description ?? item.summary ?? item["atom:summary"];
  const structuredImage = imageFromStructuredContent([content, summary], base);
  if (structuredImage) return structuredImage;
  for (const match of `${html}\n${contentText(summary)}`.matchAll(
    /<img\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
  )) {
    const url = safeFeedUrl(
      decodeHTML(match[1] ?? match[2] ?? match[3] ?? ""),
      base,
    );
    if (url) return url;
  }
  return null;
}

export function parseFeedXml(
  xml: string,
  source: FeedSourceInput,
  options: Pick<FeedFetchOptions, "now" | "maxItems"> = {},
): FeedCandidate[] {
  // No custom entities or DTDs: avoid entity expansion and all external-resource resolution.
  if (/<!\s*(DOCTYPE|ENTITY)\b/i.test(xml))
    throw new FeedSourceError(
      "Feeds containing document type or entity declarations are not supported.",
    );
  if (XMLValidator.validate(xml) !== true)
    throw new FeedSourceError(
      "The source did not return a valid RSS or Atom feed.",
    );
  let root: XmlNode;
  try {
    root = record(
      new XMLParser({
        ignoreAttributes: false,
        parseTagValue: false,
        parseAttributeValue: false,
        trimValues: false,
        processEntities: true,
        maxNestedTags: 64,
      }).parse(xml),
    );
  } catch {
    throw new FeedSourceError(
      "The source did not return a valid RSS or Atom feed.",
    );
  }
  const rss = record(root.rss);
  const atom = record(root.feed ?? root["atom:feed"]);
  const rdf = record(root["rdf:RDF"]);
  const isAtom = Object.keys(atom).length > 0;
  if (!Object.keys(rss).length && !isAtom && !Object.keys(rdf).length)
    throw new FeedSourceError("The source did not return an RSS or Atom feed.");
  const entries = isAtom
    ? list(atom.entry ?? atom["atom:entry"])
    : list(record(rss.channel).item ?? rdf.item);
  const now = options.now ?? Date.now();
  const candidates: FeedCandidate[] = [];
  const seen = new Set<string>();
  for (const entry of entries.slice(0, 300)) {
    const item = record(entry);
    const value = (key: string) => item[key] ?? item[`atom:${key}`];
    const title = feedHtmlToText(contentText(value("title")), 300);
    const links = list(value("link"));
    const link = isAtom
      ? links.find(
          (node) =>
            !record(node)["@_rel"] || record(node)["@_rel"] === "alternate",
        )
      : links[0];
    const url = safeFeedUrl(
      isAtom ? scalar(record(link)["@_href"]) : scalar(link),
      source.url,
    );
    if (!title || !url || seen.has(url)) continue;
    const html = contentText(
      value("content") ??
        item["content:encoded"] ??
        item.description ??
        value("summary"),
    );
    const body = feedHtmlToText(html);
    const summary = feedHtmlToText(
      contentText(value("summary") ?? item.description ?? html),
      800,
    );
    const date = Date.parse(
      scalar(
        value("published") ??
          item.pubDate ??
          item["dc:date"] ??
          value("updated"),
      ),
    );
    const publishedAt =
      Number.isFinite(date) && date > 0 ? Math.min(date, now) : now;
    const topics = [
      ...new Set(
        list(value("category"))
          .map((category) =>
            feedHtmlToText(scalar(record(category)["@_term"] ?? category), 80),
          )
          .filter(Boolean),
      ),
    ].slice(0, 12);
    candidates.push({
      externalId: scalar(value("id") ?? item.guid).slice(0, 1_024) || url,
      title,
      summary: summary || body.slice(0, 800),
      body,
      url,
      imageUrl: imageFromEntry(item, html, url),
      sourceName: source.name,
      sourceUrl: source.url,
      publishedAt,
      topics,
    });
    seen.add(url);
    if (candidates.length >= Math.max(1, Math.min(options.maxItems ?? 40, 100)))
      break;
  }
  return candidates;
}

export async function fetchFeedSource(
  source: FeedSourceInput,
  options: FeedFetchOptions = {},
): Promise<{
  items: FeedCandidate[];
  etag: string | null;
  lastModified: string | null;
  notModified: boolean;
}> {
  if (!source.enabled)
    return {
      items: [],
      etag: source.etag ?? null,
      lastModified: source.lastModified ?? null,
      notModified: true,
    };
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(1, Math.min(options.timeoutMs ?? 15_000, 30_000)),
  );
  const operation = async () => {
    let url = sourceUrl(source.url);
    const initialOrigin = url.origin;
    for (let redirects = 0; redirects <= 3; redirects++) {
      const address = await publicAddress(url, options, controller.signal);
      const headers = new Headers({
        Accept:
          "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9",
        "User-Agent": "Roost/1.0 Feed Reader",
        "Accept-Encoding": "identity",
      });
      if (url.origin === initialOrigin) {
        if (source.etag && !/[\r\n]/.test(source.etag))
          headers.set("If-None-Match", source.etag.slice(0, 1_024));
        if (source.lastModified && !/[\r\n]/.test(source.lastModified))
          headers.set("If-Modified-Since", source.lastModified.slice(0, 128));
      }
      const response = options.fetch
        ? await options.fetch(url, {
            headers,
            signal: controller.signal,
            redirect: "manual",
          })
        : await pinnedFetch(url, address, headers, controller.signal);
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get("location");
        if (!location || redirects === 3)
          throw new FeedSourceError(
            "The feed returned too many or invalid redirects.",
          );
        const next = sourceUrl(new URL(location, url).href);
        if (url.protocol === "https:" && next.protocol !== "https:")
          throw new FeedSourceError(
            "The feed redirected to an insecure connection.",
          );
        url = next;
        continue;
      }
      const etag = response.headers.get("etag")?.slice(0, 1_024) ?? null;
      const lastModified =
        response.headers.get("last-modified")?.slice(0, 128) ?? null;
      if (response.status === 304)
        return {
          items: [],
          etag: etag ?? source.etag ?? null,
          lastModified: lastModified ?? source.lastModified ?? null,
          notModified: true,
        };
      if (!response.ok) {
        await response.body?.cancel();
        throw new FeedSourceError(
          `The feed could not be loaded (HTTP ${response.status}).`,
        );
      }
      const xml = await readBounded(
        response,
        Math.max(1, Math.min(options.maxBytes ?? 2_000_000, 4_000_000)),
        controller.signal,
      );
      return {
        items: parseFeedXml(xml, { ...source, url: url.href }, options),
        etag,
        lastModified,
        notModified: false,
      };
    }
    throw new FeedSourceError("The feed returned too many redirects.");
  };
  try {
    // Also bounds a stalled DNS resolver or a test transport that ignores AbortSignal.
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) =>
        controller.signal.addEventListener(
          "abort",
          () => reject(new FeedSourceError("The feed request timed out.")),
          { once: true },
        ),
      ),
    ]);
  } catch (error) {
    if (controller.signal.aborted)
      throw new FeedSourceError("The feed request timed out.");
    if (error instanceof FeedSourceError) throw error;
    throw new FeedSourceError(
      "The feed could not be loaded. Check its URL and try again.",
    );
  } finally {
    clearTimeout(timeout);
  }
}
