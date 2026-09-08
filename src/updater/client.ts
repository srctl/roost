import { connect } from "node:net";
import { join } from "node:path";
export async function updaterRequest<T = unknown>(
  root: string,
  message: unknown,
): Promise<T> {
  const input = `${JSON.stringify({ protocol: 1, ...(message as object) })}\n`;
  if (Buffer.byteLength(input) > 8192)
    throw new Error("Update request too large.");
  return new Promise((resolve, reject) => {
    const socket = connect(join(root, "updates", "helper.sock"));
    let output = "";
    socket.setTimeout(20000, () =>
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
