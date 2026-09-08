import { createHash } from "node:crypto";
import { compareVersions, stableVersion } from "./contract";

export type Offer = {
  id: string;
  repository: string;
  releaseId: number;
  assetId: number;
  version: string;
  digest: string;
  size: number;
  notes: string;
  checkedAt: number;
  expiresAt: number;
};
const repositoryPattern =
  /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}(?![\s\S])/;
export const maxArchiveBytes = 512 * 1024 * 1024;

export function validateRepository(repository: string) {
  if (
    !repositoryPattern.test(repository) ||
    [".", ".."].includes(repository.split("/")[1]!)
  )
    throw new Error("Invalid configured release repository.");
}

export async function boundedBytes(response: Response, maximum: number) {
  if (!response.body) throw new Error("Empty release response.");
  const advertised = response.headers.get("content-length");
  if (
    advertised &&
    (!/^\d+$/.test(advertised) || Number(advertised) > maximum)
  ) {
    await response.body.cancel();
    throw new Error("Release response exceeds its size limit.");
  }
  const reader = response.body.getReader();
  let expired = false;
  const timeout = setTimeout(() => {
    expired = true;
    void reader.cancel("Response read deadline exceeded.").catch(() => {});
  }, 15000);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (expired) throw new Error("Response read deadline exceeded.");
      if (done) break;
      size += value.length;
      if (size > maximum)
        throw new Error("Release response exceeds its size limit.");
      chunks.push(value);
    }
    return Buffer.concat(chunks, size);
  } finally {
    clearTimeout(timeout);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function parseOffer(
  value: unknown,
  repository: string,
  now: number,
): Offer {
  validateRepository(repository);
  const release = value as {
    id: number;
    tag_name: string;
    draft: boolean;
    prerelease: boolean;
    body?: string;
    assets: {
      id: number;
      name: string;
      size: number;
      digest: string;
      url: string;
    }[];
  };
  const version =
    typeof release?.tag_name === "string" ? release.tag_name.slice(1) : "";
  if (
    release?.draft !== false ||
    release.prerelease !== false ||
    !Number.isSafeInteger(release.id) ||
    release.id <= 0 ||
    release.tag_name !== `v${version}` ||
    !stableVersion.test(version) ||
    !Array.isArray(release.assets) ||
    release.assets.length > 100
  )
    throw new Error("Release is not a published stable version.");
  const matches = release.assets.filter(
    (a) => a?.name === "roost-linux-x64.tar.gz",
  );
  const asset = matches[0];
  if (
    matches.length !== 1 ||
    !asset ||
    !Number.isSafeInteger(asset.id) ||
    asset.id <= 0 ||
    !Number.isSafeInteger(asset.size) ||
    asset.size <= 0 ||
    asset.size > maxArchiveBytes ||
    !/^sha256:[a-f0-9]{64}$/.test(asset.digest) ||
    asset.url !==
      `https://api.github.com/repos/${repository}/releases/assets/${asset.id}`
  )
    throw new Error(
      "Release has no unambiguous bounded Linux x64 artifact with a SHA-256 digest.",
    );
  const identity = {
    repository,
    releaseId: release.id,
    assetId: asset.id,
    version,
    digest: asset.digest,
    size: asset.size,
  };
  const expiresAt = now + 15 * 60_000;
  return {
    ...identity,
    id: createHash("sha256")
      .update(JSON.stringify({ ...identity, expiresAt }))
      .digest("hex"),
    notes: typeof release.body === "string" ? release.body.slice(0, 16000) : "",
    checkedAt: now,
    expiresAt,
  };
}

/** One bounded cache per configured installation, no browser-controlled sources.
 * ETags are sent only to the GitHub API; authorization never follows redirects. */
export class ReleaseChecker {
  private cache?: { offer: Offer; etag: string | null };
  private nextCheck = 0;
  private pending?: Promise<Offer>;
  constructor(
    readonly repository: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly token?: string,
    private readonly clock = Date.now,
  ) {
    validateRepository(repository);
  }

  get cached() {
    return this.cache?.offer;
  }

  check(): Promise<Offer> {
    if (this.pending) return this.pending;
    if (this.clock() < this.nextCheck)
      return Promise.reject(new Error("Wait a minute before checking again."));
    this.nextCheck = this.clock() + 60_000;
    this.pending = this.lookup().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  private async lookup() {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      ...(this.cache?.etag ? { "If-None-Match": this.cache.etag } : {}),
    };
    const response = await this.fetcher(
      `https://api.github.com/repos/${this.repository}/releases/latest`,
      {
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      },
    );
    if (response.status === 304 && this.cache) {
      // Retain the pinned offer identity/expiry; a 304 does not renew authorization.
      this.cache.offer = { ...this.cache.offer, checkedAt: this.clock() };
      return this.cache.offer;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        `Release check failed (HTTP ${response.status}). Check network and configured repository access.`,
      );
    }
    const value: unknown = JSON.parse(
      (await boundedBytes(response, 2 * 1024 * 1024)).toString("utf8"),
    );
    const offer = parseOffer(value, this.repository, this.clock());
    this.cache = { offer, etag: response.headers.get("etag") };
    return offer;
  }
}

export function assertOffer(
  offer: Offer,
  approvedId: string,
  installedVersion: string,
  now = Date.now(),
) {
  if (
    offer.id !== approvedId ||
    offer.expiresAt <= now ||
    compareVersions(offer.version, installedVersion) <= 0
  )
    throw new Error(
      "Offer expired, changed, or is not a newer version. Check again.",
    );
}
