import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setImmediate as tick } from "node:timers/promises";
import { runInNewContext } from "node:vm";
import { authGate } from "../src/server/auth/http.server";
import { AuthStore } from "../src/server/auth/store.server";
import { authenticator } from "./helpers/passkey";

class Element {
  textContent = "";
  children: Element[] = [];
  onclick?: () => Promise<void>;
  append(...children: Element[]) {
    this.children.push(...children);
  }
  replaceChildren() {
    this.children = [];
  }
}

test("the browser client serializes native credentials, enrolls, logs out, and signs back in", async () => {
  const directory = mkdtempSync(join(tmpdir(), "roost-auth-client-"));
  const old = process.env.ROOST_DATA_DIR;
  process.env.ROOST_DATA_DIR = directory;
  const store = new AuthStore(directory);
  const origin = "https://roost.example.com";
  const setup = new URL(store.setup(origin)).hash;
  const key = authenticator(origin);
  const jar = new Map<string, string>();
  const content = new Element(),
    status = new Element();
  const location = {
    hash: "",
    destination: "",
    assign(value: string) {
      this.destination = value;
    },
    replace(value: string) {
      this.destination = value;
    },
  };
  const events = new Map<string, () => void>();
  const buffer = (value: string) =>
    Uint8Array.from(Buffer.from(value, "base64url")).buffer;
  const native = (
    options: { publicKey: { challenge: Uint8Array } },
    register: boolean,
  ) => {
    const challenge = Buffer.from(options.publicKey.challenge).toString(
      "base64url",
    );
    const json = register
      ? key.registration(challenge)
      : key.assertion(challenge);
    return {
      id: json.id,
      rawId: buffer(json.id),
      type: json.type,
      getClientExtensionResults: () => ({}),
      response: {
        ...Object.fromEntries(
          Object.entries(json.response)
            .filter(([, value]) => typeof value === "string")
            .map(([key, value]) => [key, buffer(value as string)]),
        ),
        getTransports: () => ["internal"],
      },
    };
  };
  const context = {
    document: {
      querySelector: (id: string) => (id === "#content" ? content : status),
      createElement: () => new Element(),
    },
    window: {
      PublicKeyCredential: {},
      addEventListener: (name: string, fn: () => void) => events.set(name, fn),
    },
    navigator: {
      credentials: {
        create: async (options: Parameters<typeof native>[0]) =>
          native(options, true),
        get: async (options: Parameters<typeof native>[0]) =>
          native(options, false),
      },
    },
    location,
    history: {
      replaceState: () => {
        location.hash = "";
      },
    },
    URLSearchParams,
    Uint8Array,
    atob,
    btoa,
    fetch: async (path: string, init: RequestInit = {}) => {
      const response = (await authGate(
        new Request(`${origin}${path}`, {
          ...init,
          headers: {
            ...init.headers,
            Origin: origin,
            Cookie: [...jar]
              .map(([key, value]) => `${key}=${value}`)
              .join("; "),
          },
        }),
        () => new Response(),
      ))!;
      for (const value of response.headers.getSetCookie()) {
        const [name, secret] = value.split(";")[0]!.split("=");
        jar.set(name!, secret!);
      }
      return response;
    },
  };
  const source = readFileSync(
    new URL("../src/server/auth/client.js", import.meta.url),
    "utf8",
  );
  const click = async (label: string) => {
    const find = (node: Element): Element | undefined =>
      node.textContent === label ? node : node.children.map(find).find(Boolean);
    const button = find(content);
    assert.ok(button?.onclick, `Find ${label}`);
    await button.onclick();
    await tick();
    assert.equal(status.textContent, "");
  };
  try {
    runInNewContext(source, context);
    await tick();
    // Opening a setup link in an already loaded login tab must also work.
    location.hash = setup;
    events.get("hashchange")!();
    await tick();
    assert.equal(location.hash, "");
    await click("Create passkey");
    assert.equal(store.credentials().length, 1);
    assert.equal(location.destination, "/");
    runInNewContext(source, { ...context });
    await tick();
    await click("Sign out");
    assert.equal(store.sessions().length, 0);
    await click("Sign in with a passkey");
    assert.equal(store.sessions().length, 1);
  } finally {
    store.close();
    if (old === undefined) delete process.env.ROOST_DATA_DIR;
    else process.env.ROOST_DATA_DIR = old;
    rmSync(directory, { recursive: true, force: true });
  }
});
