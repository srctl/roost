import { z } from "zod";

export const vmNameSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/);
export const deviceTokenSchema = z
  .string()
  .regex(/^roost_mobile_[A-Za-z0-9_-]{43}$/);
const originSchema = z.url();
export const proxySchema = z.object({
  token: z
    .string()
    .min(20)
    .max(20000)
    .regex(/^[A-Za-z0-9._~-]+$/),
  fingerprint: z.string().regex(/^SHA256:[A-Za-z0-9+/]+={0,2}$/),
  expires: z.number().finite().positive(),
});
export const credentialsSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("manual"),
    origin: originSchema,
    token: deviceTokenSchema,
  }),
  z
    .object({
      kind: z.literal("exe"),
      origin: originSchema,
      vm: vmNameSchema,
      device: z.object({
        id: z.uuid(),
        token: deviceTokenSchema,
        expires: z.number().finite().positive(),
      }),
      proxy: proxySchema,
    })
    .refine(
      (value) => value.origin === `https://${value.vm}.exe.xyz`,
      "VM credentials must match their origin.",
    ),
]);
export type Credentials = z.infer<typeof credentialsSchema>;
export type ExeCredentials = Extract<Credentials, { kind: "exe" }>;
export type ConnectionSource = Credentials | { kind: "new-exe"; vm: string };
export type Authentication = { token: string; proxyToken?: string };

export const savedConnectionSchema = z.object({
  version: z.literal(2).optional(),
  origin: z.string(),
  token: z.string(),
});

export function decodeConnection(
  saved: unknown,
  decrypt: (data: Buffer) => string,
): Credentials {
  const record = savedConnectionSchema.parse(saved);
  const plaintext = decrypt(Buffer.from(record.token, "base64"));
  try {
    return credentialsSchema.parse(
      record.version === 2
        ? JSON.parse(plaintext)
        : { kind: "manual", origin: record.origin, token: plaintext },
    );
  } catch {
    throw new Error("Saved connection cannot be read. Reconnect this Mac.");
  }
}
export function encodeConnection(
  credentials: Credentials,
  encrypt: (data: string) => Buffer,
) {
  return {
    version: 2,
    origin: credentials.origin,
    token: encrypt(
      JSON.stringify(credentialsSchema.parse(credentials)),
    ).toString("base64"),
  };
}
