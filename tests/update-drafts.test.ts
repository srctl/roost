import assert from "node:assert/strict";
import { test } from "node:test";
import { readDraft, saveDraft } from "../src/features/updates/drafts";
import { rememberResult } from "../src/features/updates/state";

function storage() {
  const values: Record<string, string> = {};
  return new Proxy(values, {
    get: (target, key) =>
      key === "getItem"
        ? (k: string) => target[k] ?? null
        : key === "setItem"
          ? (k: string, v: string) => {
              target[k] = v;
            }
          : target[String(key)],
  });
}
test("drafts survive reload, preserve independent tab text, and do not revive sent prompts", () => {
  const oldLocal = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const oldSession = Object.getOwnPropertyDescriptor(
    globalThis,
    "sessionStorage",
  );
  try {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: storage(),
    });
    const first = storage();
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: first,
    });
    saveDraft("agent", "unsent text", []);
    assert.equal(readDraft("agent")?.text, "unsent text");
    assert.equal(readDraft("different"), null);
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: storage(),
    });
    assert.equal(readDraft("agent")?.text, "unsent text");
    saveDraft("agent", "other tab", []);
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: first,
    });
    assert.equal(readDraft("agent")?.text, "unsent text");
    saveDraft("agent", "", []);
    assert.equal(readDraft("agent")?.text, "");
    assert.throws(() => saveDraft("agent", "x".repeat(2 * 1024 * 1024), []));
  } finally {
    if (oldLocal) Object.defineProperty(globalThis, "localStorage", oldLocal);
    else Reflect.deleteProperty(globalThis, "localStorage");
    if (oldSession)
      Object.defineProperty(globalThis, "sessionStorage", oldSession);
    else Reflect.deleteProperty(globalThis, "sessionStorage");
  }
});

test("unavailable browser storage is reported separately from connectivity", () => {
  const old = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  try {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        setItem() {
          throw new Error("disabled");
        },
      },
    });
    assert.equal(rememberResult(null), true);
    assert.equal(
      rememberResult({
        id: "operation",
        requestKey: "key",
        phase: "accepted",
        previous: "0.1.40",
        version: "0.1.41",
        updatedAt: Date.now(),
        cancellable: true,
        committed: false,
        error: undefined,
        blockers: undefined,
        bytes: undefined,
      }),
      false,
    );
  } finally {
    if (old) Object.defineProperty(globalThis, "localStorage", old);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
