import { execFile } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { Effect, JSONSchema, Schema } from "effect";
import {
  type PaymentPurchase,
  PurchaseInput,
} from "../../features/payments/schema";
import { withAgentStore } from "../agents/store.server";
import type { JsonValue } from "../codex/protocol/serde_json/JsonValue";
import type { DynamicToolCallResponse } from "../codex/protocol/v2/DynamicToolCallResponse";
import type { DynamicToolSpec } from "../codex/protocol/v2/DynamicToolSpec";
import {
  beginComputerAction,
  computerStatus,
  endComputerAction,
  releaseComputer,
} from "../computer/session.server";
import { notifyAttention } from "../notifications/push.server";
import { putMessage } from "../runs/timeline.server";
import { PaymentError, PaymentStore, paymentError } from "./store.server";

const Id = Schema.Struct({ id: Schema.UUID });
const Field = Schema.Literal(
  "number",
  "cvc",
  "expiry",
  "expMonth",
  "expYear",
  "name",
  "line1",
  "line2",
  "city",
  "state",
  "postalCode",
  "country",
);
const Fill = Schema.Struct({
  id: Schema.UUID,
  fields: Schema.Array(
    Schema.Struct({
      field: Field,
      x: Schema.Number.pipe(Schema.int(), Schema.between(0, 16384)),
      y: Schema.Number.pipe(Schema.int(), Schema.between(0, 16384)),
    }),
  ).pipe(Schema.minItems(1), Schema.maxItems(12)),
});
const Record = Schema.Struct({
  id: Schema.UUID,
  orderReference: Schema.Trim.pipe(Schema.minLength(1), Schema.maxLength(500)),
  receiptUrl: Schema.optional(Schema.String.pipe(Schema.maxLength(2048))),
});
function spec(
  name: string,
  description: string,
  schema: Schema.Schema.Any,
): DynamicToolSpec {
  return {
    type: "function",
    name,
    description,
    inputSchema: JSONSchema.make(schema) as unknown as JsonValue,
  };
}

export const paymentTools = [
  spec(
    "roost_payment_status",
    "Read whether the owner's Link wallet is connected and this agent's recent purchases. Connection is user-managed in Settings → Payments on web and iPhone. Never read wallet files or use another payment CLI.",
    Schema.Struct({}),
  ),
  spec(
    "roost_request_purchase",
    "Request the user's approval IN LINK for one ordinary retail purchase. First inspect the checkout and provide the exact seller, final USD total INCLUDING shipping and taxes in cents, and description containing item, quantity and delivery destination. Reuse one requestId UUID and identical details on retry; never create a replacement because of a timeout. A pending request is NOT permission to purchase. Link approval is the payment authorization; do not ask for a second Roost approval for unchanged details. Returns an approval link displayed in web and iPhone. Use roost_wait_for_purchase to wait, then inspect checkout again before filling. Only purchase tasks authorized by the user; no transfers, trading, or speculative purchases.",
    PurchaseInput,
  ),
  spec(
    "roost_wait_for_purchase",
    "Wait up to 60 seconds for a Link purchase decision. Releases the shared desktop while waiting. May return awaiting_approval; do not interpret that as approval. On approval, take a fresh screenshot and verify seller/items/total/delivery still match. Changed details require canceling this request and obtaining a new approval. Never approve a Link request yourself.",
    Id,
  ),
  spec(
    "roost_fill_payment",
    "Fill an approved one-time Link card directly into checkout without returning credentials in tool text. First inspect a fresh roost_computer screenshot, verify the exact approved checkout, and provide pixel coordinates for each visible card/billing input. expiry is MM/YY; expMonth is MM and expYear is YYYY. Do not target unrelated fields, reveal-card pages, messages, terminals, or scripts. This only fills fields; inspect the resulting checkout with roost_computer and submit only the approved order. Requires configured shared desktop and exclusive agent ownership. Never use shell/clipboard to extract payment data.",
    Fill,
  ),
  spec(
    "roost_cancel_purchase",
    "Cancel this agent's pending/approved Link spend request if the user declines or checkout details change. This cancels payment authorization, not an order already placed; merchant refunds/returns are separate.",
    Id,
  ),
  spec(
    "roost_record_purchase",
    "After observing the merchant's actual order confirmation, record its order reference and optional HTTPS receipt URL. Approval or filling fields does not prove payment success. Never retry an uncertain purchase; inspect merchant order history first. This records your verified observation, it does not charge or refund.",
    Record,
  ),
];

type Context = { agentId: string; runId: string; signal: AbortSignal };
async function live(context: Context) {
  context.signal.throwIfAborted();
  return Effect.runPromise(
    withAgentStore((db) => {
      const row = db
        .prepare(
          "SELECT conversationId FROM runs WHERE id=? AND agentId=? AND status='running' AND cancelRequested=0",
        )
        .get(context.runId, context.agentId);
      if (!row) throw new PaymentError("This run is no longer active.");
      return String(row.conversationId);
    }),
  );
}

async function notice(context: Context, purchase: PaymentPurchase) {
  const conversationId = await live(context);
  await Effect.runPromise(
    withAgentStore((db) =>
      putMessage(
        db,
        context.agentId,
        {
          id: `payment:${purchase.id}`,
          role: "notice",
          title: `Purchase · ${purchase.merchantName}`,
          text: `${new Intl.NumberFormat("en-US", { style: "currency", currency: purchase.currency }).format(purchase.amount / 100)} · ${purchase.status.replaceAll("_", " ")}${purchase.orderReference ? ` · Order ${purchase.orderReference}` : ""}. View Payments for details.`,
        },
        conversationId,
      ),
    ),
  );
}

function command(args: string[], signal: AbortSignal, secret?: string) {
  return new Promise<void>((resolve, reject) => {
    const child = execFile(
      "xdotool",
      args,
      {
        env: { ...process.env, DISPLAY: process.env.ROOST_DESKTOP_DISPLAY },
        timeout: 8000,
        maxBuffer: 1024,
        signal,
      },
      (error) =>
        error
          ? reject(
              new PaymentError(
                "Could not fill checkout. Inspect the page before retrying.",
              ),
            )
          : resolve(),
    );
    // No card details in command arguments, stdout, exceptions, or temporary files.
    child.stdin?.on("error", () => {});
    child.stdin?.end(secret);
  });
}

export async function handlePaymentTool(
  context: Context,
  name: string,
  input: unknown,
  store = new PaymentStore(),
): Promise<DynamicToolCallResponse> {
  try {
    await live(context);
    let value: unknown;
    if (name === "roost_payment_status") value = store.read(context.agentId);
    else if (name === "roost_request_purchase") {
      const purchase = await store.request(
        context.agentId,
        context.runId,
        Schema.decodeUnknownSync(PurchaseInput)(input),
      );
      await notice(context, purchase);
      const conversationId = await live(context);
      void notifyAttention({
        agentId: context.agentId,
        conversationId,
        id: purchase.id,
        kind: "approval",
        title: `Approve purchase from ${purchase.merchantName}`,
        body: "Open Payments in Roost to review this request in Link.",
      });
      value = purchase;
    } else if (name === "roost_wait_for_purchase") {
      const { id } = Schema.decodeUnknownSync(Id)(input);
      releaseComputer(context.agentId);
      const deadline = Date.now() + 60_000;
      do {
        await live(context);
        const purchase = await store.inspect(context.agentId, id);
        value = purchase;
        if (!["creating", "awaiting_approval"].includes(purchase.status)) {
          await notice(context, purchase);
          break;
        }
        if (Date.now() + 5000 >= deadline) break;
        await delay(5000, undefined, { signal: context.signal });
      } while (Date.now() < deadline);
    } else if (name === "roost_fill_payment") {
      const args = Schema.decodeUnknownSync(Fill)(input);
      if (
        new Set(args.fields.map((field) => field.field)).size !==
        args.fields.length
      )
        throw new PaymentError(
          "Each checkout field must have a unique target.",
        );
      if (computerStatus().agentId !== context.agentId)
        throw new PaymentError(
          "Take a fresh desktop screenshot and verify checkout before filling payment.",
        );
      beginComputerAction(context.agentId);
      try {
        await store.withCard(context.agentId, args.id, async (card) => {
          await live(context);
          const fields: Partial<Record<typeof Field.Type, string>> = {
            ...card.billingAddress,
            number: card.number,
            cvc: card.cvc,
            expMonth: String(card.expMonth).padStart(2, "0"),
            expYear: String(card.expYear),
            expiry: `${String(card.expMonth).padStart(2, "0")}/${String(card.expYear).slice(-2)}`,
          };
          for (const target of args.fields)
            if (!fields[target.field] || /[\r\n\t]/.test(fields[target.field]!))
              throw new PaymentError(
                "Link did not supply one of the requested billing fields.",
              );
          for (const target of args.fields) {
            await live(context);
            await command(
              ["mousemove", String(target.x), String(target.y), "click", "1"],
              context.signal,
            );
            await command(
              ["key", "--clearmodifiers", "ctrl+a"],
              context.signal,
            );
            await command(
              ["type", "--clearmodifiers", "--file", "-"],
              context.signal,
              fields[target.field],
            );
          }
        });
      } finally {
        endComputerAction();
      }
      value = {
        filled: true,
        purchaseId: args.id,
        fields: args.fields.map((field) => field.field),
        instruction:
          "Inspect checkout and submit only the approved order. Record the merchant confirmation afterward.",
      };
    } else if (name === "roost_cancel_purchase") {
      const { id } = Schema.decodeUnknownSync(Id)(input);
      value = await store.cancel(context.agentId, id);
      await notice(context, value as PaymentPurchase);
    } else if (name === "roost_record_purchase") {
      const args = Schema.decodeUnknownSync(Record)(input);
      value = await store.record(
        context.agentId,
        args.id,
        args.orderReference,
        args.receiptUrl,
      );
      await notice(context, value as PaymentPurchase);
    } else throw new PaymentError("Unknown payment tool.");
    return {
      success: true,
      contentItems: [{ type: "inputText", text: JSON.stringify(value) }],
    };
  } catch (error) {
    return {
      success: false,
      contentItems: [{ type: "inputText", text: paymentError(error) }],
    };
  }
}
