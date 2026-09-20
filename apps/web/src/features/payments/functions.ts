import { createServerFn } from "@tanstack/react-start";
import { Schema } from "effect";
import { available } from "../../server/available";
import { PaymentStore, paymentError } from "../../server/payments/store.server";
import { PaymentQuery } from "./schema";

async function result<A>(run: (store: PaymentStore) => A | Promise<A>) {
  try {
    return { ok: true as const, value: await run(new PaymentStore()) };
  } catch (error) {
    return { ok: false as const, error: paymentError(error) };
  }
}

export const getPaymentSettings = createServerFn({ method: "POST" })
  .middleware([available])
  .validator(Schema.decodeUnknownSync(PaymentQuery))
  .handler(({ data }) => result((store) => store.read(data.agentId)));

export const connectLink = createServerFn({ method: "POST" })
  .middleware([available])
  .validator(Schema.decodeUnknownSync(Schema.Struct({})))
  .handler(() => result((store) => store.connect()));

export const refreshPayments = createServerFn({ method: "POST" })
  .middleware([available])
  .validator(Schema.decodeUnknownSync(PaymentQuery))
  .handler(({ data }) => result((store) => store.refresh(data.agentId)));

export const disconnectLink = createServerFn({ method: "POST" })
  .middleware([available])
  .validator(Schema.decodeUnknownSync(Schema.Struct({})))
  .handler(() => result((store) => store.disconnect()));
