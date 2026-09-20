import { Effect, Schema } from "effect";
import { withAgentStore } from "../agents/store.server";
import { assertAvailable } from "../maintenance.server";
import { PaymentStore, paymentError } from "../payments/store.server";

// Called exclusively behind mobile bearer authentication and origin checks.
export async function mobilePaymentRequest(
  path: string,
  request: Request,
  body: (request: Request) => Promise<unknown>,
) {
  if (!/^payments(?:\/(connect|refresh|connection))?$/.test(path)) return null;
  try {
    await Effect.runPromise(withAgentStore(assertAvailable));
    const rawAgentId = new URL(request.url).searchParams.get("agentId");
    const agentId =
      rawAgentId === null
        ? undefined
        : Schema.decodeUnknownSync(Schema.UUID)(rawAgentId);
    const store = new PaymentStore();
    if (path === "payments" && request.method === "GET")
      return { value: store.read(agentId) };
    if (path === "payments/connection" && request.method === "DELETE")
      return { value: await store.disconnect() };
    if (
      request.method === "POST" &&
      ["payments/connect", "payments/refresh"].includes(path)
    ) {
      Schema.decodeUnknownSync(Schema.Struct({}))(await body(request));
      return {
        value: path.endsWith("connect")
          ? await store.connect()
          : await store.refresh(agentId),
      };
    }
    return { value: { error: "Method not allowed." }, status: 405 };
  } catch (error) {
    return { value: { error: paymentError(error) }, status: 400 };
  }
}
