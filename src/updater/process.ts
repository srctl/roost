import { spawn } from "node:child_process";
/** Fixed program/arguments supplied only by trusted adapters, never HTTP fields. */
export function execute(
  program: string,
  args: string[],
  timeout = 120000,
  input?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, LC_ALL: "C" },
    });
    let output = "";
    let exceeded = false;
    const timer = setTimeout(() => {
      exceeded = true;
      child.kill("SIGKILL");
    }, timeout);
    child.stdout.on("data", (chunk) => {
      output += chunk;
      if (output.length > 1024 * 1024) {
        exceeded = true;
        child.kill("SIGKILL");
      }
    });
    // Never echo stderr: private download/service configuration may appear there.
    child.stderr.resume();
    child.stdin.on("error", () => {});
    child.stdin.end(input);
    child.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      code === 0 && !exceeded
        ? resolve(output.trim())
        : reject(new Error("Updater command failed or exceeded its deadline."));
    });
  });
}
