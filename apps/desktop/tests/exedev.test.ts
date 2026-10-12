import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  type Credentials,
  decodeConnection,
  encodeConnection,
} from "../src/connection-settings";
import { CredentialSession, ExeDev, type SSH } from "../src/exedev";

const token = `roost_mobile_${"a".repeat(43)}`;
const proxyToken = `exe_fixture_${"a".repeat(40)}`;
const future = () => Date.now() + 30 * 86400000;
function fixture() {
  const commands: { host: string; command: string }[] = [];
  let keys = 0;
  const run: SSH = async (host, args, signal) => {
    signal?.throwIfAborted();
    const command = args.join(" ");
    commands.push({ host, command });
    if (args[0] === "ls")
      return JSON.stringify({
        vms: [
          { vm_name: "roost-dev", status: "running", access: { shell: true } },
          { vm_name: "no-shell", status: "running", access: { shell: false } },
          { vm_name: "stopped", status: "stopped", access: { shell: true } },
        ],
      });
    if (args.includes("generate-api-key"))
      return JSON.stringify({
        token: proxyToken,
        fingerprint: `SHA256:fixture${++keys}`,
        namespace: "v0@roost-dev.exe.xyz",
        expires_at: new Date(future()).toISOString(),
      });
    if (command.includes("mobile create") || command.includes("mobile renew")) {
      const id = /--id ([a-z0-9-]+)/.exec(command)?.[1];
      return JSON.stringify({ id, token, expires: Date.now() + 90 * 86400000 });
    }
    return "{}";
  };
  return { exe: new ExeDev(run), commands, keyCount: () => keys };
}

test("exe.dev setup selects an SSH-accessible VM and provisions separate credentials without a tunnel", async () => {
  const f = fixture();
  assert.deepEqual(await f.exe.list(), [{ name: "roost-dev" }]);
  const session = new CredentialSession(
    { kind: "new-exe", vm: "roost-dev" },
    new AbortController().signal,
    () => {},
    f.exe,
  );
  const [first, second] = await Promise.all([
    session.authentication(),
    session.authentication(),
  ]);
  assert.equal(first.token, token);
  assert.equal(first.proxyToken, proxyToken);
  assert.deepEqual(first, second);
  assert.equal(f.keyCount(), 1);
  assert.equal(
    f.commands.filter((item) => item.command.includes("mobile create")).length,
    1,
  );
  assert.ok(f.commands.every((item) => !item.command.includes("-L")));
  session.commit();
  await session.revoke();
  assert.ok(f.commands.some((item) => item.command.includes("mobile revoke")));
  assert.ok(
    f.commands.some(
      (item) => item.command === "ssh-key remove SHA256:fixture1",
    ),
  );
});

test("managed credentials refresh once, persist before retiring the previous proxy key, and preserve the device ID", async () => {
  const f = fixture();
  const id = randomUUID();
  let saved: Credentials | undefined;
  const session = new CredentialSession(
    {
      kind: "exe",
      origin: "https://roost-dev.exe.xyz",
      vm: "roost-dev",
      device: { id, token, expires: Date.now() + 1000 },
      proxy: {
        token: proxyToken,
        fingerprint: "SHA256:oldkey",
        expires: Date.now() + 1000,
      },
    },
    new AbortController().signal,
    (value) => {
      assert.ok(!f.commands.some((item) => item.command.includes("remove")));
      saved = value;
    },
    f.exe,
  );
  await Promise.all([session.authentication(), session.authentication()]);
  assert.equal(f.keyCount(), 1);
  assert.ok(saved?.kind === "exe");
  assert.equal(saved.device.id, id);
  assert.equal(
    f.commands.filter((item) => item.command.includes("mobile renew")).length,
    1,
  );
  assert.ok(!f.commands.some((item) => item.command.includes("mobile create")));
  assert.ok(
    f.commands.some((item) => item.command === "ssh-key remove SHA256:oldkey"),
  );
});

test("cancelled or unknown VM setup cannot return credentials; failed setup revokes its device", async () => {
  const f = fixture();
  const controller = new AbortController();
  const session = new CredentialSession(
    { kind: "new-exe", vm: "roost-dev" },
    controller.signal,
    () => {},
    f.exe,
  );
  await session.get();
  controller.abort();
  await assert.rejects(session.authentication());
  await session.rollback();
  assert.ok(f.commands.some((item) => item.command.includes("mobile revoke")));
  const unknown = new CredentialSession(
    { kind: "new-exe", vm: "unknown" },
    new AbortController().signal,
    () => {},
    f.exe,
  );
  await assert.rejects(unknown.get(), /Choose a running VM/);
});

test("saved manual tokens remain readable and managed secrets stay inside the encrypted record", () => {
  const manual = decodeConnection(
    {
      origin: "https://roost.example.com",
      token: Buffer.from(token).toString("base64"),
    },
    (data) => data.toString(),
  );
  assert.ok(manual.kind === "manual");
  assert.equal(manual.token, token);
  let plaintext = "";
  const encoded = encodeConnection(manual, (value) => {
    plaintext = value;
    return Buffer.from("ciphertext");
  });
  assert.equal(JSON.stringify(encoded).includes(token), false);
  const decoded = decodeConnection(encoded, () => plaintext);
  assert.deepEqual(decoded, manual);
});

test("explicit reconnect renews a valid proxy credential without issuing another device", async () => {
  const f = fixture();
  const session = new CredentialSession(
    {
      kind: "exe",
      origin: "https://roost-dev.exe.xyz",
      vm: "roost-dev",
      device: { id: randomUUID(), token, expires: future() },
      proxy: {
        token: proxyToken,
        fingerprint: "SHA256:previous",
        expires: future(),
      },
    },
    new AbortController().signal,
    () => {},
    f.exe,
  );
  session.requireFreshProxy();
  await session.authentication();
  assert.equal(f.keyCount(), 1);
  assert.ok(
    !f.commands.some(
      (item) =>
        item.command.includes("mobile create") ||
        item.command.includes("mobile renew"),
    ),
  );
});

test("malformed credential responses never echo secrets and retire the newly named key", async () => {
  const secret = "exe_private_unexpected_response_123456789";
  const removed: string[] = [];
  const exe = new ExeDev(async (_host, args) => {
    if (args.includes("generate-api-key")) return secret;
    if (args[0] === "ssh-key" && args[1] === "remove") removed.push(args[2]!);
    return "{}";
  });
  await assert.rejects(
    exe.proxy("roost-dev", new AbortController().signal),
    (error: unknown) =>
      error instanceof Error &&
      /unsupported response/.test(error.message) &&
      !error.message.includes(secret),
  );
  assert.ok(removed[0]?.startsWith("roost-mac-"));
  assert.throws(
    () =>
      decodeConnection(
        { version: 2, origin: "https://roost-dev.exe.xyz", token: "opaque" },
        () => secret,
      ),
    (error: unknown) =>
      error instanceof Error && !error.message.includes(secret),
  );
});
