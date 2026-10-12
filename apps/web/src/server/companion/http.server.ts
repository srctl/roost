import { z } from "zod";
import { type CompanionBroker, companionBroker } from "./broker.server";

const envelope = z.object({ lease: z.uuid() });
async function readBody(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json")
    throw new Error("Expected JSON.");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing request body.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 5 * 1024 * 1024) {
        await reader.cancel();
        throw new Error("Desktop result is too large.");
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString());
  } finally {
    reader.releaseLock();
  }
}

export function createCompanionHandler(
  broker: CompanionBroker = companionBroker,
) {
  return async (path: string, request: Request, deviceId: string) => {
    if (!path.startsWith("companion/")) return null;
    if (path === "companion/connect" && request.method === "POST")
      return broker.connect(deviceId);
    const input = await readBody(request);
    const { lease } = envelope.parse(input);
    if (path === "companion/poll" && request.method === "POST")
      return broker.poll(deviceId, lease, input.grants);
    if (path === "companion/result" && request.method === "POST") {
      await broker.result(
        deviceId,
        lease,
        z.uuid().parse(input.id),
        input.result,
      );
      return { ok: true };
    }
    if (path === "companion/disconnect" && request.method === "POST") {
      broker.disconnect(deviceId, lease);
      return { ok: true };
    }
    throw new Error("Unknown companion request.");
  };
}
export const companionRequest = createCompanionHandler();
