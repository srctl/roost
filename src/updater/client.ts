import { connect } from "node:net";
import { join } from "node:path";
export async function updaterRequest<T = unknown>(
  root: string,
  message: unknown,
): Promise<T> {
  const input = `${JSON.stringify({ protocol: 1, ...(message as object) })}\n`;
  if (Buffer.byteLength(input) > 8192)
    throw new Error("Update request too large.");
  // Service shutdown may take 90 seconds; repair also copies data and probes
  // startup. Keep ordinary HTTP-facing requests short, with fixed CLI budgets.
  const action = (message as { action?: string })?.action;
  const timeout =
    action === "repair"
      ? 610000
      : action === "start" || action === "stop"
        ? 130000
        : 20000;
  return new Promise((resolve, reject) => {
    const socket = connect(join(root, "updates", "helper.sock"));
    let output = "";
    socket.setTimeout(timeout, () =>
      socket.destroy(
        new Error(
          "Updater did not respond. Check durable status; do not repeat activation.",
        ),
      ),
    );
    socket.once("connect", () => socket.write(input));
    socket.on("data", (chunk) => {
      output += chunk;
      if (output.length > 65536)
        socket.destroy(new Error("Updater response too large."));
    });
    socket.once("error", reject);
    socket.once("end", () => {
      if (!output.trim()) {
        reject(
          new Error(
            "Updater connection ended without a result. Check durable status before repeating an operation.",
          ),
        );
        return;
      }
      try {
        const result = JSON.parse(output);
        if (result.error) reject(new Error(result.error));
        else resolve(result.value);
      } catch {
        reject(new Error("Invalid updater response."));
      }
    });
  });
}
