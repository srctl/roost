import { createInterface } from "node:readline";

let initialized = false;
let ready = false;
const lines = createInterface({ input: process.stdin });

const send = (id, result) =>
  process.stdout.write(JSON.stringify({ id, result }) + "\n");

lines.on("line", (line) => {
  const request = JSON.parse(line);
  if (request.method === "initialize") {
    initialized = true;
    send(request.id, {});

    return;
  }
  if (request.method === "initialized") {
    ready = initialized;

    return;
  }
  if (!ready) {
    process.exit(2);
  }
  if (request.method === "exit") {
    process.exit(0);
  }
  if (request.method === "invalid") {
    process.stdout.write("invalid\n");

    return;
  }
  if (request.method === "wait") return;
  // Different delays force responses out of order.
  setTimeout(() => send(request.id, request.params), request.params.delay ?? 0);
});
