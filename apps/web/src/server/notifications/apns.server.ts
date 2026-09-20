import {
  createHash,
  createPrivateKey,
  createPublicKey,
  type KeyObject,
  sign,
} from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { type ClientHttp2Session, connect } from "node:http2";
import { isAbsolute, join, resolve } from "node:path";
import { MobileTokens } from "../mobile/tokens.server";
import type { Attention, attentionPayload } from "./push.server";

// Protocol references:
// https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns
// https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns
// https://developer.apple.com/documentation/usernotifications/handling-notification-responses-from-apns

export type APNsEnvironment = "sandbox" | "production";
export type APNsConfig = {
  teamId: string;
  keyId: string;
  bundleId: string;
  environment: APNsEnvironment;
  privateKey: KeyObject;
  identity: string;
};
export type APNsOptions = {
  directory?: string;
  env?: Record<string, string | undefined>;
  transport?: APNsTransport;
};
export type APNsRequest = {
  environment: APNsEnvironment;
  identity: string;
  deviceToken: string;
  headers: Record<string, string>;
  body: string;
};
export type APNsResponse = {
  status: number;
  reason?: string;
  timestamp?: number;
};
export type APNsTransport = (request: APNsRequest) => Promise<APNsResponse>;

const endpoints = {
  sandbox: "https://api.sandbox.push.apple.com",
  production: "https://api.push.apple.com",
} as const;

// Configuration values and key parsing failures are never returned to clients.
export function readAPNsConfig(
  env: Record<string, string | undefined> = process.env,
): APNsConfig | null {
  const teamId = env.ROOST_APNS_TEAM_ID?.trim() ?? "";
  const keyId = env.ROOST_APNS_KEY_ID?.trim() ?? "";
  const bundleId = env.ROOST_APNS_BUNDLE_ID?.trim() ?? "";
  const environment = env.ROOST_APNS_ENVIRONMENT;
  const path = env.ROOST_APNS_PRIVATE_KEY_PATH;
  if (
    !/^[A-Z0-9]{10}$/.test(teamId) ||
    !/^[A-Z0-9]{10}$/.test(keyId) ||
    bundleId.length > 255 ||
    !/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(bundleId) ||
    (environment !== "sandbox" && environment !== "production") ||
    !path ||
    !isAbsolute(path)
  )
    return null;
  try {
    const file = statSync(path);
    if (!file.isFile() || file.size > 16_384) return null;
    const privateKey = createPrivateKey(readFileSync(path));
    if (
      privateKey.asymmetricKeyType !== "ec" ||
      privateKey.asymmetricKeyDetails?.namedCurve !== "prime256v1"
    )
      return null;
    const fingerprint = createHash("sha256")
      .update(
        createPublicKey(privateKey).export({ type: "spki", format: "der" }),
      )
      .digest("hex");
    return {
      teamId,
      keyId,
      bundleId,
      environment,
      privateKey,
      identity: `${teamId}:${keyId}:${bundleId}:${fingerprint}`,
    };
  } catch {
    return null;
  }
}

const providerTokens = new Map<string, { token: string; issuedAt: number }>();
// Apple requires ES256 and a token less than one hour old. Reuse for 50 minutes
// instead of generating a new provider token for each notification.
export function apnsProviderToken(config: APNsConfig, now = Date.now()) {
  const seconds = Math.floor(now / 1000);
  const cached = providerTokens.get(config.identity);
  if (
    cached &&
    seconds >= cached.issuedAt &&
    seconds - cached.issuedAt < 50 * 60
  )
    return cached.token;
  const header = Buffer.from(
    JSON.stringify({ alg: "ES256", kid: config.keyId }),
  ).toString("base64url");
  const claims = Buffer.from(
    JSON.stringify({ iss: config.teamId, iat: seconds }),
  ).toString("base64url");
  const input = `${header}.${claims}`;
  const signature = sign("sha256", Buffer.from(input), {
    key: config.privateKey,
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");
  const token = `${input}.${signature}`;
  if (providerTokens.size >= 4)
    providerTokens.delete(providerTokens.keys().next().value!);
  providerTokens.set(config.identity, { token, issuedAt: seconds });
  return token;
}

const connections = new Map<
  APNsEnvironment,
  { identity: string; session: ClientHttp2Session }
>();
function connection(request: APNsRequest) {
  const previous = connections.get(request.environment);
  if (
    previous?.identity === request.identity &&
    !previous.session.closed &&
    !previous.session.destroyed
  )
    return previous.session;
  previous?.session.close();
  const endpoint = endpoints[request.environment];
  if (!endpoint) throw new Error("APNs is unavailable.");
  const session = connect(endpoint, { minVersion: "TLSv1.2" });
  session.on("error", () => session.destroy());
  session.on("goaway", () => session.close());
  session.setTimeout(60_000, () => session.close());
  session.unref();
  connections.set(request.environment, { identity: request.identity, session });
  return session;
}

export const sendAPNs: APNsTransport = async (input) => {
  if (
    !/^(?:[a-f0-9]{2}){1,256}$/.test(input.deviceToken) ||
    Buffer.byteLength(input.body) > 4096
  )
    throw new Error("Invalid APNs request.");
  return new Promise((resolveResponse, reject) => {
    const session = connection(input);
    const stream = session.request({
      ":method": "POST",
      ":path": `/3/device/${input.deviceToken}`,
      ...input.headers,
    });
    let status = 0;
    let size = 0;
    const chunks: Buffer[] = [];
    let finished = false;
    const finish = (failure?: boolean) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      if (failure) {
        stream.close();
        reject(new Error("APNs delivery failed."));
        return;
      }
      let response: { reason?: unknown; timestamp?: unknown } = {};
      try {
        response = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      } catch {
        /* Keep generic failure. */
      }
      resolveResponse({
        status,
        reason:
          typeof response.reason === "string" ? response.reason : undefined,
        timestamp:
          typeof response.timestamp === "number" &&
          Number.isFinite(response.timestamp)
            ? response.timestamp
            : undefined,
      });
    };
    const timeout = setTimeout(() => finish(true), 5000);
    stream.on("response", (headers) => {
      status = Number(headers[":status"]);
    });
    stream.on("data", (data: Buffer) => {
      size += data.length;
      if (size > 8192) finish(true);
      else chunks.push(data);
    });
    stream.on("end", () => finish());
    stream.on("error", () => finish(true));
    stream.on("aborted", () => finish(true));
    stream.on("close", () => {
      if (!finished) finish(true);
    });
    stream.end(input.body);
  });
};

export async function deliverNativeAttention(
  attention: Attention,
  content: ReturnType<typeof attentionPayload>,
  options: APNsOptions = {},
) {
  const result = { delivered: 0, expired: 0, failed: 0 };
  const directory =
    options.directory ?? resolve(process.env.ROOST_DATA_DIR ?? ".roost");
  if (!existsSync(join(directory, "mobile.sqlite"))) return result;
  const store = new MobileTokens(directory);
  try {
    const targets = store.pushTargets();
    if (!targets.length) return result;
    const config = readAPNsConfig(options.env);
    if (!config) return result;
    const matching = targets.filter(
      (target) =>
        target.topic === config.bundleId &&
        target.environment === config.environment,
    );
    const authorization = `bearer ${apnsProviderToken(config)}`;
    // Bound concurrency and reuse a TLS HTTP/2 session; a slow provider never
    // holds more than four requests per notification or blocks the agent run.
    for (let start = 0; start < matching.length; start += 4) {
      await Promise.all(
        matching.slice(start, start + 4).map(async (target) => {
          const current = store.pushRegistration(target.deviceId);
          if (
            current?.registrationId !== target.registrationId ||
            current.updatedAt !== target.updatedAt
          )
            return;
          const body = JSON.stringify({
            aps: {
              alert: { title: content.title, body: content.body },
              sound: "default",
              "thread-id": attention.agentId,
            },
            agentId: attention.agentId,
            conversationId: attention.conversationId ?? attention.agentId,
            registrationId: target.registrationId,
            notificationId: attention.id,
            kind: attention.kind,
            url: content.url,
          });
          if (Buffer.byteLength(body) > 4096) {
            result.failed++;
            return;
          }
          try {
            const response = await (options.transport ?? sendAPNs)({
              environment: config.environment,
              identity: config.identity,
              deviceToken: target.token,
              body,
              headers: {
                authorization,
                "apns-topic": config.bundleId,
                "apns-push-type": "alert",
                "apns-priority": "10",
                "apns-expiration": String(Math.floor(Date.now() / 1000) + 3600),
                "apns-collapse-id": createHash("sha256")
                  .update(content.tag)
                  .digest("hex"),
                "content-type": "application/json",
              },
            });
            if (response.status === 200) result.delivered++;
            else if (
              response.status === 410 ||
              (response.status === 400 &&
                ["BadDeviceToken", "DeviceTokenNotForTopic"].includes(
                  response.reason ?? "",
                ))
            ) {
              store.expirePushRegistration(
                target,
                response.status === 410 ? response.timestamp : undefined,
              );
              result.expired++;
            } else result.failed++;
          } catch {
            result.failed++;
          }
        }),
      );
    }
    return result;
  } finally {
    store.close();
  }
}
