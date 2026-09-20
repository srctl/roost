import { Effect, Schema } from "effect";
import { withAgentStore } from "../agents/store.server";
import {
  computerStatus,
  createViewer,
  viewerControl,
} from "../computer/session.server";
import { assertAvailable } from "../maintenance.server";

export async function mobileComputerRequest(
  path: string,
  request: Request,
  body: (request: Request) => Promise<unknown>,
  deviceId: string,
): Promise<{ value: unknown; status?: number } | null> {
  if (!["computer", "computer/viewer", "computer/control"].includes(path))
    return null;
  await Effect.runPromise(withAgentStore(assertAvailable));
  if (path === "computer" && request.method === "GET")
    return { value: computerStatus() };
  if (path === "computer/viewer" && request.method === "POST") {
    try {
      return { value: createViewer(`mobile:${deviceId}`) };
    } catch (error) {
      return {
        value: {
          error:
            error instanceof Error ? error.message : "Desktop unavailable.",
        },
        status: 409,
      };
    }
  }
  if (path === "computer/control" && request.method === "POST") {
    const input = Schema.decodeUnknownSync(
      Schema.Struct({
        id: Schema.String.pipe(Schema.maxLength(100)),
        control: Schema.Boolean,
      }),
    )(await body(request));
    try {
      return {
        value: viewerControl(input.id, input.control, `mobile:${deviceId}`),
      };
    } catch (error) {
      return {
        value: {
          error:
            error instanceof Error ? error.message : "Desktop unavailable.",
        },
        status: 409,
      };
    }
  }
  return { value: { error: "Method not allowed." }, status: 405 };
}
