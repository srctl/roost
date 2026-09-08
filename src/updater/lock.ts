import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { join } from "node:path";

/** flock locks the inherited open file description; the parent's fd owns it
 * after flock exits. Closing that fd (including process death) releases it.
 * Never unlink this file: doing so would create two independent lock domains. */
export async function withKernelLock<T>(
  root: string,
  action: () => Promise<T>,
) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const fd = await open(
    join(root, "updater.lock"),
    constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    const info = await fd.stat();
    if (
      !info.isFile() ||
      info.nlink !== 1 ||
      info.uid !== process.getuid?.() ||
      (info.mode & 0o077) !== 0
    )
      throw new Error("Unsafe installation lock.");
    await new Promise<void>((resolve, reject) => {
      const child = spawn("flock", ["--exclusive", "--nonblock", "3"], {
        stdio: ["ignore", "ignore", "ignore", fd.fd],
      });
      child.once("error", reject);
      child.once("exit", (code) =>
        code === 0
          ? resolve()
          : reject(
              new Error("Another Roost installation operation is active."),
            ),
      );
    });
    return await action();
  } finally {
    await fd.close();
  }
}
