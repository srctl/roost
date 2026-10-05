// Port of apps/ios/Roost/API.swift and Models.swift: the same mobile API,
// bearer token, and redirect refusal, with the same user-facing errors.

export type Connection = { server: string; token: string };

export type Agent = {
  id: string;
  name: string;
  instructions: string;
  character: string;
  model: string;
  kind?: string | null;
};

export type Attachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
};

export type Message = {
  id: string;
  role: string;
  text: string;
  title?: string | null;
  status?: string | null;
  details?: string | null;
  files?: Attachment[] | null;
  createdAt?: number | null;
};

export type Entry = { position: number; message: Message };

export type ReplyThread = {
  id: string;
  parentMessageId: string;
  parent: Message;
  replyCount: number;
  status?: string | null;
};

export type Snapshot = {
  entries: Entry[];
  revision: number;
  before: number | null;
  threads: ReplyThread[];
  busy: boolean;
  runId: string | null;
  status: string | null;
};

export type Approval = {
  id: string;
  runId: string;
  title: string;
  details: string;
  questions?: {
    id: string;
    question: string;
    options: { label: string; description: string }[];
    allowOther: boolean;
  }[];
};

export type SendRequest = {
  messageId: string;
  conversationId: string;
  text: string;
  attachmentIds: string[];
};

export type FeedItem = {
  id: string;
  kind: string;
  title: string;
  summary: string;
  body: string;
  url: string | null;
  imageUrl: string | null;
  sourceName: string;
  publishedAt: number;
  saved: boolean;
  dismissed: boolean;
  why: string;
  importance: string;
};

export type FeedSnapshot = {
  items: FeedItem[];
  nextCursor: number | null;
  status: {
    refreshing: boolean;
    lastRefreshedAt: number | null;
    lastError: string | null;
  };
};

export class APIError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
  }

  // Only explicit pre-enqueue rejections are safe to edit and resend with a
  // new message identity. Anything else keeps the pending payload for retry.
  get rejectsMessage() {
    return (
      this.code === "message_rejected" ||
      [401, 403, 404, 405, 413, 415, 422].includes(this.status ?? 0)
    );
  }
}

const tokenPattern = /^roost_mobile_[A-Za-z0-9_-]{43}$/;

export function makeConnection(server: string, token: string): Connection {
  let url: URL;
  try {
    url = new URL(server.trim());
  } catch {
    throw new APIError(
      "Enter your server address without a path, for example https://roost.example.com.",
    );
  }
  if (
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "" && url.pathname !== "/")
  ) {
    throw new APIError(
      "Enter your server address without a path, for example https://roost.example.com.",
    );
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (!(url.protocol === "https:" || (url.protocol === "http:" && local))) {
    throw new APIError(
      "Use HTTPS to protect your device token. HTTP is available only for localhost development.",
    );
  }
  const trimmed = token.trim();
  if (!tokenPattern.test(trimmed)) {
    throw new APIError("Paste a Roost device token.");
  }
  return { server: url.origin, token: trimmed };
}

export class RoostAPI {
  constructor(readonly connection: Connection) {}

  async request(
    path: string,
    init: {
      method?: string;
      query?: Record<string, string>;
      body?: unknown;
    } = {},
  ): Promise<Response> {
    const url = new URL(`api/mobile/v1/${path}`, `${this.connection.server}/`);
    for (const [key, value] of Object.entries(init.query ?? {})) {
      url.searchParams.set(key, value);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    let response: Response;
    try {
      response = await fetch(url, {
        method: init.method ?? "GET",
        headers: {
          Authorization: `Bearer ${this.connection.token}`,
          Accept: "application/json",
          ...(init.body === undefined
            ? {}
            : { "Content-Type": "application/json" }),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        // Never follow a proxy/login redirect with device credentials.
        redirect: "manual",
        credentials: "omit",
        signal: controller.signal,
      });
    } catch {
      throw new APIError("The server did not respond.");
    } finally {
      clearTimeout(timeout);
    }
    if (response.status === 401) {
      throw new APIError(
        "Your device token expired or was revoked. Replace it in Settings to reconnect.",
        401,
      );
    }
    if (
      response.type === "opaqueredirect" ||
      (response.status >= 300 && response.status < 400)
    ) {
      throw new APIError(
        "This address redirects to a browser sign-in. Use a direct HTTPS endpoint for the mobile API.",
      );
    }
    if (!response.ok) {
      const error = (await response.json().catch(() => null)) as {
        error?: string;
        code?: string;
      } | null;
      throw new APIError(
        error?.error ?? `Roost returned an error (${response.status}).`,
        response.status,
        error?.code,
      );
    }
    return response;
  }

  async get<T>(path: string, query?: Record<string, string>): Promise<T> {
    const response = await this.request(path, { query });
    try {
      return (await response.json()) as T;
    } catch {
      throw new APIError(
        "This server does not support this version of the Roost app. Update Roost and check the server address.",
      );
    }
  }

  async post<T = unknown>(path: string, body: unknown): Promise<T> {
    const response = await this.request(path, { method: "POST", body });
    const text = await response.text();
    return (text ? JSON.parse(text) : null) as T;
  }
}
