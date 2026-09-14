import {
  type AuthenticationResponseJSON,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import {
  ceremonyCookie,
  cookie,
  sessionCookie,
  sessionId,
  setCookie,
} from "./session.server";
import {
  type AuthStore,
  digest,
  openAuth,
  sessionLifetime,
} from "./store.server";

const noStore = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};
const json = (value: unknown, status = 200, cookies: string[] = []) => {
  const headers = new Headers(noStore);
  for (const value of cookies) headers.append("Set-Cookie", value);
  return Response.json(value, { status, headers });
};
function requireSession(store: AuthStore, request: Request, recent = false) {
  const session = store.session(sessionId(request));
  if (!session) throw new Error("Sign in to continue.");
  if (recent && session.created < Date.now() - 5 * 60_000)
    throw new Error("Sign in again before changing passkeys or sessions.");
  return session;
}
async function body(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json")
    throw new Error("Expected JSON.");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing request.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 32_768) {
        await reader.cancel();
        throw new Error("Request too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = JSON.parse(Buffer.concat(chunks).toString());
  if (!result || typeof result !== "object" || Array.isArray(result))
    throw new Error("Invalid request.");
  return result;
}
async function action(store: AuthStore, request: Request, operation: string) {
  const config = store.config();
  const rpID = new URL(config.origin).hostname;
  if (
    !store.limit(
      operation.endsWith("verify") ? "verify" : "options",
      operation.endsWith("verify") ? 20 : 60,
    )
  )
    return json({ error: "Too many requests. Try again in a minute." }, 429);
  const data = await body(request);
  const current = store.session(sessionId(request));
  if (operation === "login-options" || operation === "register-options") {
    let kind: "login" | "setup" | "add" = "login";
    let bootstrap: string | null = null;
    if (operation === "register-options") {
      if (typeof data.setup === "string") {
        bootstrap = digest(data.setup);
        if (
          config.bootstrap !== bootstrap ||
          config.expires < Date.now() ||
          store.credentials().length
        )
          throw new Error(
            "Setup link expired or was already used. Generate another link on the server.",
          );
        kind = "setup";
      } else {
        requireSession(store, request, true);
        kind = "add";
      }
      if (store.credentials().length >= 20)
        throw new Error("Remove an unused passkey first.");
    }
    const options =
      kind === "login"
        ? await generateAuthenticationOptions({
            rpID,
            userVerification: "required",
          })
        : await generateRegistrationOptions({
            rpName: "Roost",
            rpID,
            userName: "Roost owner",
            userID: Buffer.from(config.owner, "base64url"),
            attestationType: "none",
            authenticatorSelection: {
              residentKey: "required",
              userVerification: "required",
            },
            excludeCredentials: store
              .credentials()
              .map(({ id, transports }) => ({ id, transports })),
          });
    const secret = store.ceremony({
      challenge: options.challenge,
      kind,
      session: kind === "add" ? current!.id : null,
      bootstrap,
      generation: config.generation,
    });
    return json({ options }, 200, [setCookie(ceremonyCookie, secret, 300)]);
  }
  if (operation === "login-verify" || operation === "register-verify") {
    const ceremony = store.consumeCeremony(cookie(request, ceremonyCookie));
    if (ceremony.generation !== config.generation)
      throw new Error("Authentication changed. Try again.");
    let credentialId: string;
    if (operation === "register-verify") {
      if (ceremony.kind === "login") throw new Error("Invalid request.");
      if (
        ceremony.kind === "add" &&
        requireSession(store, request, true).id !== ceremony.session
      )
        throw new Error("Sign in again.");
      const result = await verifyRegistrationResponse({
        response: data.response as RegistrationResponseJSON,
        expectedChallenge: ceremony.challenge,
        expectedOrigin: config.origin,
        expectedRPID: rpID,
        requireUserVerification: true,
      });
      if (!result.verified || !result.registrationInfo)
        throw new Error("Could not verify the passkey.");
      const { credential } = result.registrationInfo;
      credentialId = credential.id;
      store.transaction(() => {
        if (store.config().generation !== ceremony.generation)
          throw new Error("Authentication changed. Try again.");
        if (ceremony.kind === "setup") store.finishSetup(ceremony.bootstrap);
        else if (requireSession(store, request, true).id !== ceremony.session)
          throw new Error("Sign in again.");
        if (store.credentials().some((value) => value.id === credential.id))
          throw new Error("This passkey is already registered.");
        if (store.credentials().length >= 20)
          throw new Error("Remove an unused passkey first.");
        store.saveCredential({
          ...credential,
          publicKey: Buffer.from(credential.publicKey).toString("base64url"),
          name:
            typeof data.name === "string"
              ? data.name.trim().slice(0, 80) || "Passkey"
              : "Passkey",
          created: Date.now(),
        });
      });
    } else {
      if (ceremony.kind !== "login") throw new Error("Invalid request.");
      const response = data.response as AuthenticationResponseJSON;
      const credential = store
        .credentials()
        .find((value) => value.id === response?.id);
      if (!credential) throw new Error("Could not verify the passkey.");
      if (
        response.response.userHandle &&
        response.response.userHandle !== config.owner
      )
        throw new Error("Could not verify the passkey.");
      const result = await verifyAuthenticationResponse({
        response,
        expectedChallenge: ceremony.challenge,
        expectedOrigin: config.origin,
        expectedRPID: rpID,
        requireUserVerification: true,
        credential: {
          ...credential,
          publicKey: Buffer.from(credential.publicKey, "base64url"),
        },
      });
      if (!result.verified) throw new Error("Could not verify the passkey.");
      credentialId = credential.id;
      store.transaction(() => {
        const latest = store
          .credentials()
          .find((value) => value.id === credential.id);
        if (
          store.config().generation !== ceremony.generation ||
          !latest ||
          latest.counter !== credential.counter
        )
          throw new Error("Authentication changed. Try again.");
        store.saveCredential({
          ...latest,
          counter: result.authenticationInfo.newCounter,
        });
      });
    }
    // A recovery or revocation cannot race an asynchronous verification into
    // creating a session: recheck the generation and credential in this transaction.
    const secret = store.transaction(() => {
      if (
        store.config().generation !== ceremony.generation ||
        !store.credentials().some((value) => value.id === credentialId)
      )
        throw new Error("Authentication changed. Try again.");
      if (ceremony.kind === "add") requireSession(store, request, true);
      if (current) store.revokeSession(current.id);
      return store.createSession(credentialId);
    });
    return json({ ok: true }, 200, [
      setCookie(sessionCookie, secret, sessionLifetime / 1000),
      setCookie(ceremonyCookie, "", 0),
    ]);
  }
  const session = requireSession(store, request, operation !== "logout");
  if (operation === "logout") {
    store.revokeSession(session.id);
    return json({ ok: true }, 200, [setCookie(sessionCookie, "", 0)]);
  }
  if (operation === "remove-passkey" && typeof data.id === "string") {
    store.removeCredential(data.id);
    return json({ ok: true });
  }
  if (operation === "revoke-session" && typeof data.id === "string") {
    store.revokeSession(data.id);
    return json({ ok: true });
  }
  return json({ error: "Not found." }, 404);
}

/** Returns null only when the request may reach the application. */
export async function authGate(
  request: Request,
  authPage: () => Response,
): Promise<Response | null> {
  const url = new URL(request.url);
  const store = openAuth();
  if (!store) {
    if (url.pathname === "/auth/api/state") return json({ enabled: false });
    if (url.pathname === "/auth")
      return new Response(null, {
        status: 303,
        headers: { Location: "/settings", ...noStore },
      });
    return null;
  }
  try {
    const config = store.config();
    // Health reveals no user data and remains accessible to the installer and proxy.
    if (url.pathname === "/api/health" && request.method === "GET") return null;
    if (url.host !== new URL(config.origin).host)
      return json({ error: "Unexpected host." }, 403);
    if (
      !["GET", "HEAD"].includes(request.method) &&
      request.headers.get("origin") !== config.origin
    )
      return json({ error: "Unexpected origin." }, 403);
    if (
      request.headers.get("sec-fetch-site") === "cross-site" &&
      request.headers.get("sec-fetch-mode") !== "navigate"
    )
      return json({ error: "Unexpected origin." }, 403);
    const session = store.session(sessionId(request));
    if (url.pathname === "/auth" && request.method === "GET") return authPage();
    if (url.pathname === "/auth/api/state" && request.method === "GET") {
      if (!session)
        return json({
          enabled: true,
          authenticated: false,
          setup: Boolean(config.bootstrap),
        });
      return json({
        enabled: true,
        authenticated: true,
        credentials: store
          .credentials()
          .map(({ id, name, created }) => ({ id, name, created })),
        sessions: store
          .sessions()
          .map((value) => ({ ...value, current: value.id === session.id })),
        recent: session.created >= Date.now() - 5 * 60_000,
      });
    }
    if (url.pathname.startsWith("/auth/api/") && request.method === "POST") {
      try {
        return await action(
          store,
          request,
          url.pathname.slice("/auth/api/".length),
        );
      } catch {
        return json(
          {
            error:
              "Could not complete this request. Retry, sign in again, or generate a new setup link if it expired.",
          },
          400,
        );
      }
    }
    if (!session) {
      if (
        request.method === "GET" &&
        request.headers.get("accept")?.includes("text/html")
      )
        return new Response(null, {
          status: 303,
          headers: { Location: "/auth", ...noStore },
        });
      return json({ error: "Sign in required." }, 401);
    }
    return null;
  } finally {
    store.close();
  }
}
