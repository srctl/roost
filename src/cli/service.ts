import { spawn } from "node:child_process";
import { join } from "node:path";

export type Installation = {
  root: string;
  user: string;
  home: string;
  uid: number;
  port: number;
  repository?: string;
};

export const serviceName = (config: Installation) =>
  `roost-${config.uid}.service`;

const quote = (value: string) =>
  `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%")}"`;

export function serviceUnit(config: Installation) {
  const current = join(config.root, "current");

  return `[Unit]
Description=Roost agent server (${config.user})
After=network-online.target
Wants=network-online.target

[Service]
Type=exec
User=${config.user}
Environment=${quote(`HOME=${config.home}`)}
Environment=${quote(`ROOST_HOME=${config.root}`)}
ExecStart=${quote(join(current, "runtime/node"))} ${quote(join(current, "cli/roost.mjs"))} server run
Restart=on-failure
RestartSec=3
TimeoutStopSec=90
KillMode=control-group
UMask=0077

[Install]
WantedBy=multi-user.target
`;
}

export function command(
  program: string,
  args: string[],
  capture = false,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, {
      stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
    });
    let output = "";
    child.stdout?.on("data", (chunk) => {
      output += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve(output.trim())
        : reject(
            new Error(`${program} exited with status ${code ?? "signal"}.`),
          ),
    );
  });
}

export const service = (config: Installation, action: string) =>
  command("sudo", ["systemctl", action, serviceName(config)]);

export const isActive = async (config: Installation) =>
  command(
    "systemctl",
    ["is-active", "--quiet", serviceName(config)],
    true,
  ).then(
    () => true,
    () => false,
  );

export async function waitForServer(config: Installation, version: string) {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(
        `http://127.0.0.1:${config.port}/api/health`,
        { signal: AbortSignal.timeout(1000) },
      );
      const health = (await response.json()) as { version?: string };
      if (response.ok && health.version === version) return;
    } catch {
      /* The listener may still be starting. */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    "Roost did not become healthy. Run roost server logs to inspect the failure.",
  );
}
