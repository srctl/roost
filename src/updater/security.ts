import { createHmac, timingSafeEqual } from "node:crypto";
import { boundedBytes } from "./releases";

export function csrfToken(secret: string, session: string) {
  return createHmac("sha256", secret)
    .update(`roost-update-v1:${session}`)
    .digest("hex");
}

export function authorizeMutation(
  request: Request,
  context: {
    origin: string;
    session: { id: string; created: number } | undefined;
    secret: string;
    now?: number;
  },
) {
  const { session, origin, secret, now = Date.now() } = context;
  if (!session || session.created < now - 5 * 60_000 || session.created > now)
    throw new Error("Recent native passkey authentication required.");
  if (
    request.method !== "POST" ||
    new URL(request.url).host !== new URL(origin).host ||
    request.headers.get("origin") !== origin ||
    request.headers.get("sec-fetch-site") === "cross-site" ||
    request.headers.get("content-type")?.split(";")[0] !== "application/json"
  )
    throw new Error("Invalid update request origin or content type.");
  const supplied = request.headers.get("x-roost-csrf") ?? "";
  const expected = csrfToken(secret, session.id);
  if (
    !/^[a-f0-9]{64}$/.test(supplied) ||
    !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
  )
    throw new Error("Invalid update CSRF token.");
}

export async function updateBody(request: Request, allowed: readonly string[]) {
  const response = new Response(request.body, { headers: request.headers });
  const value: unknown = JSON.parse(
    (await boundedBytes(response, 2048)).toString("utf8"),
  );
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    throw new Error("Unexpected update fields.");
  return value as Record<string, unknown>;
}
