import { test } from "node:test";
import assert from "node:assert/strict";
import { Effect } from "effect";
import { computerPreviewAnchor } from "../src/features/computer/preview";
import type { Message } from "../src/features/chat/schema";
import {
  createViewer,
  connectViewer,
  disconnectViewer,
  viewerControl,
  beginComputerAction,
  endComputerAction,
  releaseComputer,
  attachViewer,
  computerStatus,
} from "../src/server/computer/session.server";
import {
  computerAction,
  computerTools,
} from "../src/server/computer/tools.server";

test("the live preview stays with a turn's first computer action and moves only when a later turn uses the computer", () => {
  const messages: Message[] = [
    { id: "user-1", role: "user", text: "Look it up" },
  ];
  assert.equal(computerPreviewAnchor(messages), undefined);
  messages.push({
    id: "computer-1",
    role: "activity",
    title: "roost_computer",
    text: "",
  });
  messages.push({
    id: "computer-2",
    role: "activity",
    title: "roost_computer",
    text: "",
  });
  messages.push({ id: "reply", role: "assistant", text: "Found it" });
  messages.push({ id: "user-2", role: "user", text: "Thanks" });
  assert.equal(computerPreviewAnchor(messages), "computer-1");
  messages.push({
    id: "computer-3",
    role: "activity",
    title: "roost_computer",
    text: "",
  });
  assert.equal(computerPreviewAnchor(messages), "computer-3");
});

test("desktop tickets require the configured origin, expire, and can only connect once", () => {
  const oldDisplay = process.env.ROOST_DESKTOP_DISPLAY;
  const oldOrigin = process.env.ROOST_DESKTOP_ORIGIN;
  process.env.ROOST_DESKTOP_DISPLAY = ":1";
  process.env.ROOST_DESKTOP_ORIGIN = "https://roost.test";
  const now = Date.now;
  try {
    const ticket = createViewer();
    assert.equal(connectViewer(ticket.id, "https://evil.test"), false);
    assert.equal(connectViewer(ticket.id, null), false);
    assert.equal(connectViewer(ticket.id, "https://roost.test"), true);
    assert.equal(connectViewer(ticket.id, "https://roost.test"), false);
    disconnectViewer(ticket.id);
    const expired = createViewer();
    Date.now = () => now() + 61_000;
    assert.equal(connectViewer(expired.id, "https://roost.test"), false);
    disconnectViewer(expired.id);
  } finally {
    Date.now = now;
    if (oldDisplay === undefined) delete process.env.ROOST_DESKTOP_DISPLAY;
    else process.env.ROOST_DESKTOP_DISPLAY = oldDisplay;
    if (oldOrigin === undefined) delete process.env.ROOST_DESKTOP_ORIGIN;
    else process.env.ROOST_DESKTOP_ORIGIN = oldOrigin;
  }
});

test("human control blocks agent screenshots and input; expired control disconnects its viewer before allowing agent input", async () => {
  process.env.ROOST_DESKTOP_DISPLAY = ":1";
  process.env.ROOST_DESKTOP_ORIGIN = "https://roost.test";
  const now = Date.now;
  const viewer = createViewer();
  try {
    connectViewer(viewer.id, "https://roost.test");
    beginComputerAction("agent-a");
    assert.throws(() => beginComputerAction("agent-b"), /Another agent/);
    assert.throws(() => viewerControl(viewer.id, true), /finishing/);
    endComputerAction();
    viewerControl(viewer.id, true);
    assert.throws(
      () => beginComputerAction("agent-a"),
      /user has taken control/,
    );
    const result = await Effect.runPromise(
      computerAction("agent-a", { action: "screenshot" }),
    );
    assert.equal(result.success, false);
    let disconnected = false;
    attachViewer(viewer.id, () => {
      disconnected = true;
    });
    Date.now = () => now() + 31_000;
    assert.equal(computerStatus().humanControlled, false);
    assert.equal(disconnected, true);
    beginComputerAction("agent-a");
    endComputerAction();
    releaseComputer("agent-a");
    beginComputerAction("agent-b");
    endComputerAction();
    releaseComputer("agent-b");
    assert.equal(computerTools[0]?.inputSchema.type, "object");
  } finally {
    Date.now = now;
    endComputerAction();
    releaseComputer("agent-a");
    releaseComputer("agent-b");
    disconnectViewer(viewer.id);
    delete process.env.ROOST_DESKTOP_DISPLAY;
    delete process.env.ROOST_DESKTOP_ORIGIN;
  }
});
