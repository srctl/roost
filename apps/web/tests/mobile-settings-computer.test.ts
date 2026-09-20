import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { test } from "node:test";
import { Effect } from "effect";
import {
  beginComputerAction,
  connectMobileViewer,
  connectViewer,
  createViewer,
  disconnectViewer,
  endComputerAction,
  releaseComputer,
} from "../src/server/computer/session.server";
import { createMobileHandler } from "../src/server/mobile/http.server";
import {
  MobileTokens,
  mobileDeviceActive,
} from "../src/server/mobile/tokens.server";
import { getNotificationPreferences } from "../src/server/notifications/preferences.server";

test("native notification settings update shared preferences, and desktop tickets remain bound to authenticated devices", async () => {
  const directory = mkdtempSync("/tmp/roost-mobile-settings-");
  const previous = {
    data: process.env.ROOST_DATA_DIR,
    display: process.env.ROOST_DESKTOP_DISPLAY,
    origin: process.env.ROOST_DESKTOP_ORIGIN,
  };
  process.env.ROOST_DATA_DIR = directory;
  process.env.ROOST_DESKTOP_DISPLAY = ":1";
  process.env.ROOST_DESKTOP_ORIGIN = "https://roost.test";
  const tokens = new MobileTokens(directory);
  const first = tokens.create("iPhone"),
    second = tokens.create("Other iPhone");
  const handle = createMobileHandler(async () => {});
  let ticket = "";
  const request = (
    path: string,
    method = "GET",
    body?: unknown,
    secret = first.secret,
    headers = {},
  ) =>
    handle(
      new Request(`https://roost.test/api/mobile/v1/${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  try {
    assert.equal(
      (
        await request("settings/notifications", "POST", {
          needsAttention: false,
        })
      )?.status,
      200,
    );
    assert.deepEqual(await Effect.runPromise(getNotificationPreferences()), {
      enabled: true,
      turnCompleted: true,
      agentUpdates: true,
      needsAttention: false,
    });
    assert.equal(
      (await request("settings/notifications", "POST", { enabled: "no" }))
        ?.status,
      400,
    );
    assert.equal(
      (
        await request(
          "settings/notifications",
          "GET",
          undefined,
          first.secret,
          { Origin: "https://roost.test" },
        )
      )?.status,
      403,
    );
    assert.equal(
      (await request("computer", "GET", undefined, "invalid"))?.status,
      401,
    );
    assert.equal((await request("computer", "GET"))?.status, 200);
    const response = await request("computer/viewer", "POST", {});
    assert.equal(response?.status, 200);
    ticket = (await response!.json()).id;
    assert.equal(connectViewer(ticket, "https://roost.test", null), false);
    assert.equal(connectMobileViewer(ticket, second.id), false);
    assert.equal(connectMobileViewer(ticket, first.id), true);
    assert.equal(
      connectMobileViewer(ticket, first.id),
      false,
      "ticket is one-use",
    );
    assert.equal(
      (
        await request(
          "computer/control",
          "POST",
          { id: ticket, control: true },
          second.secret,
        )
      )?.status,
      409,
    );
    assert.equal(
      (await request("computer/control", "POST", { id: ticket, control: true }))
        ?.status,
      200,
    );
    assert.throws(() => beginComputerAction("agent"), /user has taken control/);
    assert.equal(
      (
        await request("computer/control", "POST", {
          id: ticket,
          control: false,
        })
      )?.status,
      200,
    );
    beginComputerAction("agent");
    endComputerAction();
    releaseComputer("agent");
    const browser = createViewer("browser-session");
    assert.equal(connectMobileViewer(browser.id, first.id), false);
    disconnectViewer(browser.id);
    assert.equal(mobileDeviceActive(first.id), true);
    tokens.revoke(first.id);
    assert.equal(mobileDeviceActive(first.id), false);
    assert.equal(
      (await request("computer/control", "POST", { id: ticket, control: true }))
        ?.status,
      401,
    );
  } finally {
    if (ticket) disconnectViewer(ticket);
    tokens.close();
    for (const [key, value] of [
      ["ROOST_DATA_DIR", previous.data],
      ["ROOST_DESKTOP_DISPLAY", previous.display],
      ["ROOST_DESKTOP_ORIGIN", previous.origin],
    ]) {
      if (value === undefined) delete process.env[key!];
      else process.env[key!] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
