import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
} from "node:crypto";

const sha = (value: string | Buffer) =>
  createHash("sha256").update(value).digest();
const b64 = (value: Buffer) => value.toString("base64url");
// Small CBOR encoder for an actual ES256 authenticator fixture, not production crypto.
function cbor(value: unknown): Buffer {
  const header = (major: number, n: number) =>
    n < 24
      ? Buffer.from([major * 32 + n])
      : n < 256
        ? Buffer.from([major * 32 + 24, n])
        : Buffer.from([major * 32 + 25, n >> 8, n & 255]);
  if (typeof value === "number")
    return header(value < 0 ? 1 : 0, value < 0 ? -1 - value : value);
  if (Buffer.isBuffer(value))
    return Buffer.concat([header(2, value.length), value]);
  if (typeof value === "string")
    return Buffer.concat([
      header(3, Buffer.byteLength(value)),
      Buffer.from(value),
    ]);
  const pairs =
    value instanceof Map ? [...value] : Object.entries(value as object);
  return Buffer.concat([
    header(5, pairs.length),
    ...pairs.flatMap(([key, val]) => [cbor(key), cbor(val)]),
  ]);
}
export function authenticator(origin = "https://roost.example.com") {
  const key = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = key.publicKey.export({ format: "jwk" });
  const id = randomBytes(32);
  let counter = 0;
  const data = (challenge: string, type: string, testOrigin = origin) =>
    Buffer.from(
      JSON.stringify({
        type,
        challenge,
        origin: testOrigin,
        crossOrigin: false,
      }),
    );
  return {
    id: b64(id),
    registration(challenge: string, uv = true, testOrigin = origin) {
      const cose = cbor(
        new Map<number, unknown>([
          [1, 2],
          [3, -7],
          [-1, 1],
          [-2, Buffer.from(jwk.x!, "base64url")],
          [-3, Buffer.from(jwk.y!, "base64url")],
        ]),
      );
      const authData = Buffer.concat([
        sha(new URL(origin).hostname),
        Buffer.from([uv ? 0x45 : 0x41]),
        Buffer.alloc(4),
        Buffer.alloc(16),
        Buffer.from([0, id.length]),
        id,
        cose,
      ]);
      return {
        id: b64(id),
        rawId: b64(id),
        type: "public-key",
        clientExtensionResults: {},
        response: {
          clientDataJSON: b64(data(challenge, "webauthn.create", testOrigin)),
          attestationObject: b64(cbor({ fmt: "none", attStmt: {}, authData })),
          transports: ["internal"],
        },
      };
    },
    assertion(challenge: string, uv = true, testOrigin = origin) {
      const count = Buffer.alloc(4);
      count.writeUInt32BE(++counter);
      const authData = Buffer.concat([
        sha(new URL(origin).hostname),
        Buffer.from([uv ? 5 : 1]),
        count,
      ]);
      const client = data(challenge, "webauthn.get", testOrigin);
      return {
        id: b64(id),
        rawId: b64(id),
        type: "public-key",
        clientExtensionResults: {},
        response: {
          clientDataJSON: b64(client),
          authenticatorData: b64(authData),
          signature: b64(
            sign(
              "sha256",
              Buffer.concat([authData, sha(client)]),
              key.privateKey,
            ),
          ),
        },
      };
    },
  };
}
