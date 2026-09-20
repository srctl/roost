import { Link, LinkApiError, type SpendRequest } from "@stripe/link-sdk";

// The SDK intentionally leaves OAuth to its embedding application. These
// endpoints, public client ID, and scopes match stripe/link-cli's auth resource:
// https://github.com/stripe/link-cli/blob/main/packages/cli/src/auth/auth-resource.ts
const AUTH_ORIGIN = "https://login.link.com";
const CLIENT_ID = "lwlpk_U7Qy7ThG69STZk";
const LINK_HOSTS = new Set(["link.com", "app.link.com", "login.link.com"]);

/** Server-private. Never include this type in a tool or HTTP response. */
export type LinkTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope?: string;
};

/** deviceCode is server-private; only the other fields may reach the owner UI. */
export type PendingLinkConnection = {
  deviceCode: string;
  verificationUrl: string;
  userCode: string;
  expiresAt: number;
  intervalSeconds: number;
  nextPollAt: number;
};

export type LinkConnectionResult =
  | { status: "pending"; pending: PendingLinkConnection }
  | { status: "connected"; tokens: LinkTokens };

export type LinkWallet = {
  name: string | null;
  email: string | null;
  verificationUrl: string | null;
  verificationStatus: string | null;
};

export type LinkSpendInput = {
  merchantName: string;
  merchantUrl: string;
  amount: number;
  currency: string;
  context: string;
  items?: Array<{ name: string; quantity: number; unitAmount: number }>;
  test?: boolean;
};

export type LinkSpendStatus =
  | "awaiting_approval"
  | "approved"
  | "declined"
  | "expired"
  | "completed"
  | "failed"
  | "cancelled"
  | "requires_action"
  | "processing";

export type LinkSpend = {
  id: string;
  status: LinkSpendStatus;
  providerStatus: string;
  approvalUrl: string | null;
  actionUrl: string | null;
  activityUrl: string | null;
  merchantName: string | null;
  merchantUrl: string | null;
  amount: number | null;
  currency: string | null;
  cardLast4: string | null;
  expiresAt: number | null;
};

/** Ephemeral server-only credential: never persist, log, or return to an agent. */
export type LinkCard = {
  number: string;
  cvc: string;
  expMonth: number;
  expYear: number;
  billingAddress?: {
    name: string;
    line1: string;
    line2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country: string;
  };
  validUntil: string | null;
};

export class LinkProviderError extends Error {
  constructor(
    readonly code:
      | "connection_expired"
      | "connection_declined"
      | "sign_in_required"
      | "unavailable"
      | "invalid_response"
      | "invalid_request"
      | "not_approved"
      | "not_found",
    message: string,
  ) {
    super(message);
    this.name = "LinkProviderError";
  }
}

function invalidResponse(): never {
  throw new LinkProviderError(
    "invalid_response",
    "Link returned an invalid response. Try again.",
  );
}

function text(value: unknown, max = 4000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    return invalidResponse();
  return value;
}

function nullableText(value: unknown, max = 4000): string | null {
  return value == null ? null : text(value, max);
}

function positiveInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0)
    return invalidResponse();
  return value;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return invalidResponse();
  return value as Record<string, unknown>;
}

export function safeLinkUrl(value: unknown): string | null {
  if (value == null) return null;
  try {
    const url = new URL(text(value));
    if (
      url.protocol === "https:" &&
      LINK_HOSTS.has(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.port
    )
      return url.href;
  } catch {
    // Never forward untrusted URLs or provider errors to the browser.
  }
  return invalidResponse();
}

function spendId(value: string): string {
  if (!/^lsrq_[a-zA-Z0-9_]{1,200}$/.test(value))
    throw new LinkProviderError(
      "invalid_request",
      "Invalid Link purchase identifier.",
    );
  return value;
}

function normalizeSpend(value: SpendRequest): LinkSpend {
  const statuses: Record<string, LinkSpendStatus> = {
    created: "awaiting_approval",
    pending_approval: "awaiting_approval",
    approved: "approved",
    denied: "declined",
    expired: "expired",
    succeeded: "completed",
    failed: "failed",
    canceled: "cancelled",
    requires_action: "requires_action",
    submitted: "processing",
  };
  const amount = value.amount ?? null;
  if (amount !== null && (!Number.isSafeInteger(amount) || amount < 0))
    invalidResponse();
  if (value.currency != null && !/^[a-zA-Z]{3}$/.test(value.currency))
    invalidResponse();
  const expiresAt =
    value.expires_at == null ? null : positiveInteger(value.expires_at) * 1000;
  // Explicit allowlist: SDK responses may include card, LPT, or SPT credentials,
  // even on endpoints where the caller did not request them.
  return {
    id: spendId(value.id),
    status: statuses[value.status] ?? "failed",
    providerStatus: text(value.status, 100),
    approvalUrl: safeLinkUrl(value.approval_url),
    actionUrl: safeLinkUrl(
      value.status_details?.requires_action?.next_action.action_url,
    ),
    activityUrl: safeLinkUrl(value.activity_url),
    merchantName: nullableText(value.merchant_name, 500),
    merchantUrl: nullableText(value.merchant_url),
    amount,
    currency: nullableText(value.currency, 3)?.toLowerCase() ?? null,
    cardLast4:
      typeof value.card_last4 === "string" && /^\d{4}$/.test(value.card_last4)
        ? value.card_last4
        : null,
    expiresAt,
  };
}

export function createLinkProvider(
  options: { fetch?: typeof globalThis.fetch; now?: () => number } = {},
) {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const secureFetch: typeof globalThis.fetch = (input, init) =>
    fetchImpl(input, {
      ...init,
      redirect: "error",
      signal: init?.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(20_000)])
        : AbortSignal.timeout(20_000),
    });

  async function safe<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof LinkProviderError) throw error;
      // SDK errors retain full response bodies and may include payment secrets.
      // Deliberately discard message, cause, rawBody, and details at this boundary.
      if (
        error instanceof LinkApiError &&
        (error.status === 401 || error.status === 403)
      )
        throw new LinkProviderError(
          "sign_in_required",
          "Reconnect your Link wallet to continue.",
        );
      throw new LinkProviderError(
        "unavailable",
        "Link could not complete this request. Try again.",
      );
    }
  }

  async function auth(path: string, body: Record<string, string>) {
    const response = await secureFetch(`${AUTH_ORIGIN}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: CLIENT_ID, ...body }).toString(),
    });
    // Successful revocation may have an empty response body.
    if (path === "/device/revoke" && response.ok) return { ok: true, data: {} };
    const data = object(await response.json());
    return { ok: response.ok, data };
  }

  function tokens(
    data: Record<string, unknown>,
    previous?: LinkTokens,
  ): LinkTokens {
    if (text(data.token_type, 100).toLowerCase() !== "bearer")
      invalidResponse();
    return {
      accessToken: text(data.access_token, 32000),
      refreshToken:
        data.refresh_token == null && previous
          ? previous.refreshToken
          : text(data.refresh_token, 32000),
      expiresAt: now() + positiveInteger(data.expires_in) * 1000,
      ...(typeof data.scope === "string"
        ? { scope: text(data.scope, 4000) }
        : previous?.scope
          ? { scope: previous.scope }
          : {}),
    };
  }

  function client(authTokens: LinkTokens) {
    // Refresh is explicit so the owning store can serialize and durably save
    // refresh-token rotation before issuing another operation.
    return new Link({
      accessToken: authTokens.accessToken,
      fetch: secureFetch,
      verbose: false,
    });
  }

  return {
    beginConnection: () =>
      safe(async (): Promise<PendingLinkConnection> => {
        const { ok, data } = await auth("/device/code", {
          scope: "userinfo:read payment_methods.agentic",
          connection_label: "Roost",
          client_hint: "Roost",
        });
        if (!ok)
          throw new LinkProviderError(
            "unavailable",
            "Could not start Link sign-in. Try again.",
          );
        const verificationUrl = safeLinkUrl(
          data.verification_uri_complete ?? data.verification_uri,
        );
        if (!verificationUrl) invalidResponse();
        const intervalSeconds = Math.max(
          5,
          positiveInteger(data.interval ?? 5),
        );
        return {
          deviceCode: text(data.device_code, 32000),
          verificationUrl,
          userCode: text(data.user_code, 200),
          expiresAt: now() + positiveInteger(data.expires_in) * 1000,
          intervalSeconds,
          nextPollAt: now() + intervalSeconds * 1000,
        };
      }),

    pollConnection: (pending: PendingLinkConnection) =>
      safe(async (): Promise<LinkConnectionResult> => {
        if (pending.expiresAt <= now())
          throw new LinkProviderError(
            "connection_expired",
            "Link sign-in expired. Start again.",
          );
        if (pending.nextPollAt > now()) return { status: "pending", pending };
        const { ok, data } = await auth("/device/token", {
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: pending.deviceCode,
        });
        if (ok) return { status: "connected", tokens: tokens(data) };
        if (
          data.error === "authorization_pending" ||
          data.error === "slow_down"
        ) {
          const intervalSeconds =
            pending.intervalSeconds + (data.error === "slow_down" ? 5 : 0);
          return {
            status: "pending",
            pending: {
              ...pending,
              intervalSeconds,
              nextPollAt: now() + intervalSeconds * 1000,
            },
          };
        }
        if (data.error === "expired_token")
          throw new LinkProviderError(
            "connection_expired",
            "Link sign-in expired. Start again.",
          );
        if (
          data.error === "access_denied" ||
          data.error === "authorization_failed"
        )
          throw new LinkProviderError(
            "connection_declined",
            "Link wallet connection was not approved.",
          );
        throw new LinkProviderError(
          "unavailable",
          "Could not finish Link sign-in. Try again.",
        );
      }),

    refreshToken: (previous: LinkTokens) =>
      safe(async () => {
        const { ok, data } = await auth("/device/token", {
          grant_type: "refresh_token",
          refresh_token: previous.refreshToken,
        });
        if (!ok)
          throw new LinkProviderError(
            "sign_in_required",
            "Reconnect your Link wallet to continue.",
          );
        return tokens(data, previous);
      }),

    revoke: (authTokens: LinkTokens) =>
      safe(async () => {
        const { ok } = await auth("/device/revoke", {
          token: authTokens.refreshToken,
        });
        if (!ok)
          throw new LinkProviderError(
            "unavailable",
            "Could not disconnect Link. Try again.",
          );
      }),

    wallet: (authTokens: LinkTokens) =>
      safe(async (): Promise<LinkWallet> => {
        const value = await client(authTokens).userInfo.retrieve();
        return {
          name: nullableText(value.name, 500),
          email: nullableText(value.email, 500),
          verificationStatus: nullableText(
            value.agent_wallet_verification_requirement?.status,
            100,
          ),
          verificationUrl: safeLinkUrl(
            value.agent_wallet_verification_requirement?.action_url,
          ),
        };
      }),

    createSpend: (
      authTokens: LinkTokens,
      input: LinkSpendInput,
      idempotencyKey: string,
    ) =>
      safe(async () => {
        if (
          !Number.isSafeInteger(input.amount) ||
          input.amount <= 0 ||
          input.amount > 50000 ||
          !/^[a-zA-Z]{3}$/.test(input.currency) ||
          input.context.length < 100 ||
          input.context.length > 4000 ||
          !input.merchantName.trim() ||
          input.merchantName.length > 500 ||
          !/^[a-zA-Z0-9_-]{16,200}$/.test(idempotencyKey)
        )
          throw new LinkProviderError(
            "invalid_request",
            "Provide the merchant, a detailed purchase description, currency, and a total of at most 50,000 minor units.",
          );
        let merchantUrl: URL;
        try {
          merchantUrl = new URL(input.merchantUrl);
        } catch {
          throw new LinkProviderError(
            "invalid_request",
            "Provide a valid HTTPS merchant URL.",
          );
        }
        if (
          merchantUrl.protocol !== "https:" ||
          merchantUrl.username ||
          merchantUrl.password
        )
          throw new LinkProviderError(
            "invalid_request",
            "Provide a valid HTTPS merchant URL.",
          );
        if (
          input.items &&
          (input.items.length > 100 ||
            input.items.some(
              (item) =>
                !item.name.trim() ||
                item.name.length > 500 ||
                !Number.isSafeInteger(item.quantity) ||
                item.quantity <= 0 ||
                !Number.isSafeInteger(item.unitAmount) ||
                item.unitAmount < 0,
            ))
        )
          throw new LinkProviderError(
            "invalid_request",
            "Provide valid purchase items and quantities.",
          );
        const value = await client(authTokens).spendRequests.create({
          idempotency_key: idempotencyKey,
          merchant_name: input.merchantName,
          merchant_url: merchantUrl.href,
          amount: input.amount,
          currency: input.currency.toLowerCase(),
          context: input.context,
          credential_type: "card",
          request_approval: true,
          ...(input.items
            ? {
                line_items: input.items.map((item) => ({
                  name: item.name,
                  quantity: item.quantity,
                  unit_amount: item.unitAmount,
                })),
              }
            : {}),
          totals: [
            { type: "total", display_text: "Total", amount: input.amount },
          ],
          ...(input.test === true ? { test: true } : {}),
        });
        return normalizeSpend(value);
      }),

    retrieveSpend: (authTokens: LinkTokens, id: string) =>
      safe(async () => {
        const value = await client(authTokens).spendRequests.retrieve(
          spendId(id),
        );
        if (!value)
          throw new LinkProviderError(
            "not_found",
            "This Link purchase could not be found.",
          );
        if (value.id !== id) invalidResponse();
        return normalizeSpend(value);
      }),

    cancelSpend: (authTokens: LinkTokens, id: string) =>
      safe(async () =>
        normalizeSpend(
          await client(authTokens).spendRequests.cancel(spendId(id)),
        ),
      ),

    card: (authTokens: LinkTokens, id: string) =>
      safe(async (): Promise<LinkCard> => {
        const value = await client(authTokens).spendRequests.retrieve(
          spendId(id),
          { include: ["card"] },
        );
        if (
          !value ||
          value.id !== id ||
          value.status !== "approved" ||
          !value.card
        )
          throw new LinkProviderError(
            "not_approved",
            "This purchase is not approved for payment.",
          );
        const card = value.card;
        if (
          !/^\d{12,19}$/.test(card.number) ||
          !/^\d{3,4}$/.test(card.cvc ?? "") ||
          !Number.isInteger(card.exp_month) ||
          card.exp_month < 1 ||
          card.exp_month > 12 ||
          !Number.isInteger(card.exp_year) ||
          card.exp_year < new Date(now()).getUTCFullYear() ||
          (card.exp_year === new Date(now()).getUTCFullYear() &&
            card.exp_month < new Date(now()).getUTCMonth() + 1)
        )
          invalidResponse();
        if (
          (value.expires_at != null && value.expires_at * 1000 <= now()) ||
          (card.valid_until != null &&
            (!Number.isFinite(Date.parse(card.valid_until)) ||
              Date.parse(card.valid_until) <= now()))
        )
          throw new LinkProviderError(
            "not_approved",
            "This purchase's payment credential has expired.",
          );
        const address = card.billing_address;
        return {
          number: card.number,
          cvc: card.cvc!,
          expMonth: card.exp_month,
          expYear: card.exp_year,
          validUntil: nullableText(card.valid_until, 100),
          ...(address
            ? {
                billingAddress: {
                  name: text(address.name, 500),
                  line1: text(address.line1, 500),
                  ...(address.line2 ? { line2: text(address.line2, 500) } : {}),
                  ...(address.city ? { city: text(address.city, 500) } : {}),
                  ...(address.state ? { state: text(address.state, 500) } : {}),
                  ...(address.postal_code
                    ? { postalCode: text(address.postal_code, 100) }
                    : {}),
                  country: text(address.country, 2),
                },
              }
            : {}),
        };
      }),
  };
}

export const linkProvider = createLinkProvider();
export type LinkProvider = ReturnType<typeof createLinkProvider>;
