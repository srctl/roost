import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { mkdir, open, readFile } from "node:fs/promises";
import { join } from "node:path";
import { durableJson } from "./journal";

/** flock locks the inherited open file description; the parent's fd owns it
 * after flock exits. Closing that fd (including process death) releases it.
 * Never unlink this file: doing so would create two independent lock domains. */
export async function withKernelLock<T>(
  root: string,
  action: () => Promise<T>,
  scope: "installation" | "supervisor" = "installation",
) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const fd = await open(
    join(
      root,
      scope === "installation" ? "updater.lock" : "updater-supervisor.lock",
    ),
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
    const stat = await readFile(`/proc/${process.pid}/stat`, "utf8");
    await durableJson(
      join(
        root,
        scope === "installation"
          ? "updater-owner.json"
          : "updater-supervisor-owner.json",
      ),
      {
        pid: process.pid,
        boot: (
          await readFile("/proc/sys/kernel/random/boot_id", "utf8")
        ).trim(),
        startTicks: stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19],
        acquiredAt: Date.now(),
      },
    );
    // Advisory diagnostics may remain after exit; only the kernel lock grants ownership.
    return await action();
  } finally {
    await fd.close();
  }
}
