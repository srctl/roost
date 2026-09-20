import { createInterface } from "node:readline";

createInterface({ input: process.stdin }).on("line", (line) => {
  const { id, method } = JSON.parse(line);
  if (method === "test/invalid") {
    process.stdout.write(
      "private provider output must never appear in diagnostics\n",
    );
  } else if (method === "test/stall") {
    process.stdout.write(
      `${JSON.stringify({ method: "test/waiting", params: {} })}\n`,
    );
  } else {
    process.stdout.write(`${JSON.stringify({ id, result: {} })}\n`);
  }
});
