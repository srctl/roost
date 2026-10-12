import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type HeaderHandler,
  installWorkspaceAuthentication,
} from "../src/workspace-auth";

test("workspace proxy authentication is confined to its origin and never injects the Roost device token", async () => {
  let listener: HeaderHandler | undefined;
  installWorkspaceAuthentication(
    (value) => {
      listener = value;
    },
    "https://roost-dev.exe.xyz",
    async () => ({
      token: "private-roost-device",
      proxyToken: "private-proxy",
    }),
  );
  const outgoing = (url: string, requestHeaders: Record<string, string>) =>
    new Promise<Parameters<Parameters<HeaderHandler>[1]>[0]>((resolve) => {
      assert.ok(listener);
      listener({ url, requestHeaders }, resolve);
    });
  const trusted = await outgoing("https://roost-dev.exe.xyz/assets/app.js", {});
  assert.deepEqual(trusted, {
    requestHeaders: { "X-Exedev-Authorization": "Bearer private-proxy" },
  });
  assert.deepEqual(
    await outgoing("wss://roost-dev.exe.xyz/api/computer/socket", {}),
    trusted,
  );
  assert.deepEqual(
    await outgoing("ws://roost-dev.exe.xyz/api/computer/socket", {}),
    { requestHeaders: {} },
  );
  const redirected = await outgoing("https://other.example/", {
    "X-Exedev-Authorization": "Bearer private-proxy",
  });
  assert.deepEqual(redirected, { requestHeaders: {} });
});
