export function serverOrigin(value: string) {
  const url = new URL(value.trim());
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error(
      "Enter an HTTPS server origin, such as https://roost.example.com. Localhost may use HTTP.",
    );
  }
  return url.origin;
}

export class RoostAPI {
  readonly origin: string;
  constructor(
    origin: string,
    private token: string,
    private signal?: AbortSignal,
  ) {
    this.origin = serverOrigin(origin);
    if (!/^roost_mobile_[A-Za-z0-9_-]{43}$/.test(token))
      throw new Error("Enter a valid Roost device token.");
  }
  async request(
    path: string,
    data?: unknown,
    signal: AbortSignal | null | undefined = this.signal,
  ) {
    // Credentials are only sent to this exact API origin, never a redirect or
    // a renderer. Browser login and device authentication remain independent.
    const response = await fetch(`${this.origin}/api/mobile/v1/${path}`, {
      method: data === undefined ? "GET" : "POST",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(data === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(6000)])
        : AbortSignal.timeout(6000),
    });
    signal?.throwIfAborted();
    if (response.status === 401)
      throw new Error(
        "The device token expired or was revoked. Reconnect with a new token.",
      );
    if (!response.ok)
      throw new Error(
        `Roost returned ${response.status}. Check that this server supports the desktop companion.`,
      );
    if (!response.headers.get("content-type")?.includes("application/json"))
      throw new Error(
        "The device API returned a login page. Make its token-authenticated endpoint directly reachable.",
      );
    const text = await response.text();
    if (text.length > 1024 * 1024)
      throw new Error("Roost returned too much data.");
    return JSON.parse(text);
  }
}
