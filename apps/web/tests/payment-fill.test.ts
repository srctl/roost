import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Effect } from "effect";
import { saveAgent, withAgentStore } from "../src/server/agents/store.server";
import {
  beginComputerAction,
  connectViewer,
  createViewer,
  disconnectViewer,
  endComputerAction,
  releaseComputer,
  viewerControl,
} from "../src/server/computer/session.server";
import type {
  LinkCard,
  LinkProvider,
  LinkSpend,
} from "../src/server/payments/provider.server";
import { PaymentStore } from "../src/server/payments/store.server";
import { handlePaymentTool } from "../src/server/payments/tools.server";
import { enqueueChat } from "../src/server/runs/store.server";

type CapturedCommand = { argv: string[]; stdin: string };

test("payment filling uses approved credentials only through subprocess stdin and respects desktop/run boundaries", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "roost-payment-fill-"));
  chmodSync(directory, 0o700);
  const log = join(directory, "fake-xdotool.jsonl");
  const executable = join(directory, "xdotool");
  // This replaces every xdotool invocation. It only records fictional fixture
  // data in a private temporary file and never accesses a real desktop.
  writeFileSync(
    executable,
    `#!${process.execPath}
const fs = require("node:fs");
let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => { stdin += chunk; });
process.stdin.on("end", () => {
  fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ argv: process.argv.slice(2), stdin }) + "\\n", { mode: 0o600 });
});
`,
    { mode: 0o700 },
  );
  const previous = {
    ROOST_DATA_DIR: process.env.ROOST_DATA_DIR,
    ROOST_DESKTOP_DISPLAY: process.env.ROOST_DESKTOP_DISPLAY,
    ROOST_DESKTOP_ORIGIN: process.env.ROOST_DESKTOP_ORIGIN,
    PATH: process.env.PATH,
  };
  Object.assign(process.env, {
    ROOST_DATA_DIR: directory,
    ROOST_DESKTOP_DISPLAY: ":fixture-only",
    ROOST_DESKTOP_ORIGIN: "https://roost.example",
    PATH: `${directory}:${previous.PATH ?? ""}`,
  });
  const agentId = randomUUID();
  const runId = randomUUID();
  const purchaseId = randomUUID();
  const otherAgent = randomUUID();
  let viewerId: string | undefined;
  t.after(() => {
    if (viewerId) disconnectViewer(viewerId);
    endComputerAction();
    releaseComputer(agentId);
    releaseComputer(otherAgent);
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  });
  await Effect.runPromise(
    saveAgent({
      id: agentId,
      name: "Buyer",
      instructions: "Help with the owner's purchases",
      model: "fixture",
      character: "moss",
    }),
  );
  await Effect.runPromise(
    enqueueChat({ agentId, messageId: runId, text: "Buy the approved book" }),
  );
  await Effect.runPromise(
    withAgentStore((db) =>
      db.prepare("UPDATE runs SET status='running' WHERE id=?").run(runId),
    ),
  );
  const spend: LinkSpend = {
    id: "lsrq_fill_test",
    status: "awaiting_approval",
    providerStatus: "pending_approval",
    approvalUrl: "https://app.link.com/approve/lsrq_fill_test",
    actionUrl: null,
    activityUrl: null,
    merchantName: "Bookshop",
    merchantUrl: "https://bookshop.example/checkout",
    amount: 2500,
    currency: "usd",
    cardLast4: "1984",
    expiresAt: Date.now() + 600_000,
  };
  const card: LinkCard = {
    number: "4000009990001984",
    cvc: "987",
    expMonth: 12,
    expYear: 2030,
    validUntil: new Date(Date.now() + 3_600_000).toISOString(),
    billingAddress: {
      name: "Test Owner",
      line1: "1 Example Street",
      country: "US",
    },
  };
  let cardCalls = 0;
  const unexpected = async (): Promise<never> => {
    throw new Error("Unexpected provider operation; no network is allowed.");
  };
  const provider: LinkProvider = {
    beginConnection: async () => ({
      deviceCode: "private-device-code",
      verificationUrl: "https://link.com/verify",
      userCode: "PEACH-MOSS",
      expiresAt: Date.now() + 600_000,
      intervalSeconds: 5,
      nextPollAt: 0,
    }),
    pollConnection: async () => ({
      status: "connected",
      tokens: {
        accessToken: "private-access-token",
        refreshToken: "private-refresh-token",
        expiresAt: Date.now() + 3_600_000,
      },
    }),
    wallet: async () => ({
      name: "Owner",
      email: "owner@example.com",
      verificationUrl: null,
      verificationStatus: null,
    }),
    createSpend: async () => ({ ...spend }),
    retrieveSpend: async () => ({ ...spend }),
    card: async () => {
      cardCalls++;
      return structuredClone(card);
    },
    cancelSpend: unexpected,
    refreshToken: unexpected,
    revoke: unexpected,
  };
  const store = new PaymentStore(directory, provider);
  await store.connect();
  await store.refresh();
  await store.request(agentId, runId, {
    requestId: purchaseId,
    merchantName: spend.merchantName!,
    merchantUrl: spend.merchantUrl!,
    amount: spend.amount!,
    currency: "usd",
    description: "One book delivered to the owner's selected home address.",
  });
  const controller = new AbortController();
  const context = { agentId, runId, signal: controller.signal };
  const args = {
    id: purchaseId,
    fields: [
      { field: "number", x: 120, y: 200 },
      { field: "expiry", x: 120, y: 250 },
      { field: "cvc", x: 120, y: 300 },
    ],
  };
  const commands = (): CapturedCommand[] =>
    existsSync(log)
      ? readFileSync(log, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as CapturedCommand)
      : [];
  const takeAgentOwnership = () => {
    beginComputerAction(agentId);
    endComputerAction();
  };

  await t.test("pending payment does not retrieve or type a card", async () => {
    takeAgentOwnership();
    const result = await handlePaymentTool(
      context,
      "roost_fill_payment",
      args,
      store,
    );
    assert.equal(result.success, false);
    assert.match(JSON.stringify(result), /Approve this purchase/);
    assert.equal(cardCalls, 0);
    assert.deepEqual(commands(), []);
  });

  await t.test(
    "approved fill types through stdin without clicking submit or returning card data",
    async () => {
      spend.status = "approved";
      spend.providerStatus = "approved";
      const result = await handlePaymentTool(
        context,
        "roost_fill_payment",
        args,
        store,
      );
      assert.equal(result.success, true);
      assert.equal(cardCalls, 1);
      const captured = commands();
      assert.equal(captured.length, 9);
      for (const [index, field] of args.fields.entries()) {
        assert.deepEqual(captured[index * 3]!.argv, [
          "mousemove",
          String(field.x),
          String(field.y),
          "click",
          "1",
        ]);
        assert.deepEqual(captured[index * 3 + 1]!.argv, [
          "key",
          "--clearmodifiers",
          "ctrl+a",
        ]);
        assert.deepEqual(captured[index * 3 + 2]!.argv, [
          "type",
          "--clearmodifiers",
          "--file",
          "-",
        ]);
        assert.equal(captured[index * 3]!.stdin, "");
        assert.equal(captured[index * 3 + 1]!.stdin, "");
      }
      assert.deepEqual(
        captured
          .filter((command) => command.argv[0] === "type")
          .map((command) => command.stdin),
        [card.number, "12/30", card.cvc],
      );
      const visible = JSON.stringify({
        result,
        argv: captured.map((command) => command.argv),
        publicState: store.read(),
      });
      for (const secret of [
        card.number,
        "private-access-token",
        "private-refresh-token",
      ])
        assert.ok(!visible.includes(secret));
      // A three-digit CVC can occur by coincidence in a timestamp or UUID.
      // Compare actual argument/response values rather than their substrings.
      assert.ok(captured.every((command) => !command.argv.includes(card.cvc)));
      const content = result.contentItems[0]!;
      assert.equal(content.type, "inputText");
      if (content.type !== "inputText") return;
      const output = JSON.parse(content.text);
      assert.deepEqual(output.fields, ["number", "expiry", "cvc"]);
      assert.equal(output.filled, true);
      assert.ok(!Object.values(output).includes(card.cvc));
      assert.equal(statSync(log).mode & 0o777, 0o600);
    },
  );

  await t.test(
    "wrong desktop ownership and human control block filling",
    async () => {
      releaseComputer(agentId);
      beginComputerAction(otherAgent);
      endComputerAction();
      assert.equal(
        (await handlePaymentTool(context, "roost_fill_payment", args, store))
          .success,
        false,
      );
      releaseComputer(otherAgent);
      takeAgentOwnership();
      const viewer = createViewer();
      viewerId = viewer.id;
      assert.equal(connectViewer(viewer.id, "https://roost.example"), true);
      viewerControl(viewer.id, true);
      assert.equal(
        (await handlePaymentTool(context, "roost_fill_payment", args, store))
          .success,
        false,
      );
      disconnectViewer(viewer.id);
      viewerId = undefined;
      assert.equal(cardCalls, 1);
      assert.equal(commands().length, 9);
    },
  );

  await t.test(
    "newline-bearing billing fields are rejected before any desktop input",
    async () => {
      card.billingAddress!.name = "Test Owner\nUnintended input";
      const result = await handlePaymentTool(
        context,
        "roost_fill_payment",
        {
          id: purchaseId,
          fields: [
            { field: "number", x: 120, y: 200 },
            { field: "name", x: 120, y: 350 },
          ],
        },
        store,
      );
      assert.equal(result.success, false);
      assert.match(JSON.stringify(result), /billing fields/);
      assert.equal(cardCalls, 2);
      assert.equal(commands().length, 9);
      card.billingAddress!.name = "Test Owner";
    },
  );

  await t.test(
    "canceled or aborted runs cannot consume payment credentials",
    async () => {
      await Effect.runPromise(
        withAgentStore((db) =>
          db.prepare("UPDATE runs SET cancelRequested=1 WHERE id=?").run(runId),
        ),
      );
      assert.equal(
        (await handlePaymentTool(context, "roost_fill_payment", args, store))
          .success,
        false,
      );
      await Effect.runPromise(
        withAgentStore((db) =>
          db.prepare("UPDATE runs SET cancelRequested=0 WHERE id=?").run(runId),
        ),
      );
      controller.abort();
      assert.equal(
        (await handlePaymentTool(context, "roost_fill_payment", args, store))
          .success,
        false,
      );
      assert.equal(cardCalls, 2);
      assert.equal(commands().length, 9);
    },
  );
});
