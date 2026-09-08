import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { userInfo } from "node:os";
import { join } from "node:path";
import { type Installation, serviceName, serviceUnit } from "../cli/service";
import { compatibility } from "./contract";
import { durableJson, syncDirectory } from "./journal";
import { withKernelLock } from "./lock";
import { execute } from "./process";
import { validateRepository } from "./releases";

// Release qualification is a reviewed build decision, not a browser, environment,
// enrollment flag, or same-user editable claim. Change only with recorded evidence.
export const activationQualified = false;
export const legacyFence =
  "Roost supervised updater enrolled: permanent legacy CLI fence. DO NOT DELETE.\n";
export type Enrollment = {
  protocol: 1;
  installation: Installation;
  helperVersion: string;
  platform: "ubuntu-24.04-x64";
};
export async function validateInstallation(c: Installation) {
  validateRepository(c.repository ?? "");
  const user = userInfo();
  if (Buffer.byteLength(join(c.root, "updates/helper.sock")) > 100)
    throw new Error(
      "Installation path is too long for the private updater socket.",
    );
  if (
    process.platform !== "linux" ||
    process.arch !== "x64" ||
    user.uid === 0 ||
    c.uid !== user.uid ||
    c.user !== user.username ||
    !/^[a-z_][a-z0-9_-]*$/.test(c.user) ||
    !/^\/[A-Za-z0-9_./-]{1,160}$/.test(c.root) ||
    !/^\/[A-Za-z0-9_./-]{1,160}$/.test(c.home) ||
    c.root !== (await realpath(c.root)) ||
    !Number.isInteger(c.port) ||
    c.port < 1024 ||
    c.port > 65535
  )
    throw new Error("Unsupported installation identity.");
  for (const path of [
    c.root,
    join(c.root, "data"),
    join(c.root, "config.json"),
    join(c.root, "releases"),
  ]) {
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || stat.uid !== c.uid || stat.mode & 0o022)
      throw new Error(
        "Installation paths must be privately controlled by the installation user.",
      );
  }
  if ((await lstat(c.root)).mode & 0o077)
    throw new Error(
      "Enrollment requires an owner-only installation root (mode 0700), protecting every retained release and snapshot from other users.",
    );
  const os = await readFile("/etc/os-release", "utf8");
  if (
    !/^ID=ubuntu$/m.test(os) ||
    !/^VERSION_ID="24.04"$/m.test(os) ||
    !existsSync("/run/systemd/system")
  )
    throw new Error(
      "Initial enrollment requires Ubuntu 24.04 x64 and systemd.",
    );
  const fs = await execute("/usr/bin/findmnt", [
    "-n",
    "-o",
    "FSTYPE",
    "-T",
    c.root,
  ]);
  if (fs !== "ext4")
    throw new Error(
      "Initial enrollment requires persistent local ext4 storage.",
    );
  const release = await realpath(join(c.root, "current"));
  if (
    !release.startsWith(`${join(c.root, "releases")}/`) ||
    release.split("/").at(-1)?.includes("..")
  )
    throw new Error("Invalid current release.");
  compatibility(
    JSON.parse(await readFile(join(release, "compatibility.json"), "utf8")),
  );
  await execute(
    "/usr/bin/python3",
    ["-c", "import socket; assert hasattr(socket, 'SO_PEERCRED')"],
    5000,
  );
}
/** The initial contract excludes custom hooks and additional service writers. */
export async function validateService(c: Installation) {
  const unit = serviceName(c);
  const path = `/etc/systemd/system/${unit}`;
  const info = await lstat(path);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.uid !== 0 ||
    info.mode & 0o022 ||
    (await readFile(path, "utf8")) !== serviceUnit(c)
  )
    throw new Error(
      "Custom or unprotected application service requires operator maintenance.",
    );
  const dropins = await execute("/usr/bin/systemctl", [
    "show",
    unit,
    "--property=DropInPaths",
    "--value",
  ]);
  const allowed = `/etc/systemd/system/${unit}.d/updater.conf`;
  if (dropins && dropins !== allowed)
    throw new Error(
      "Additional application service overrides are unsupported.",
    );
  if (dropins) {
    const override = await lstat(allowed);
    if (
      !override.isFile() ||
      override.isSymbolicLink() ||
      override.uid !== 0 ||
      override.mode & 0o022 ||
      (await readFile(allowed, "utf8")) !== enrollmentFiles(c, "0.0.0").dropin
    )
      throw new Error("Application startup gate differs from enrollment.");
  }
}
export function enrollmentFiles(c: Installation, version: string) {
  const unit = serviceName(c),
    helper = `roost-${c.uid}-updater.service`;
  const pinned = join(c.root, "releases", version);
  return {
    helper,
    unit: `[Unit]\nDescription=Roost supervised updater (${c.user})\nAfter=network-online.target\nWants=network-online.target\nBefore=${unit}\n\n[Service]\nType=exec\nUser=${c.user}\nEnvironment=HOME=${c.home}\nEnvironment=ROOST_HOME=${c.root}\nExecStart=${pinned}/runtime/node ${pinned}/cli/roost.mjs updates serve\nRestart=on-failure\nRestartSec=3\nKillMode=control-group\nTimeoutStopSec=15\nUMask=0077\n\n[Install]\nWantedBy=multi-user.target\n`,
    dropin: `[Unit]\nRequires=${helper}\nAfter=${helper}\n\n[Service]\nEnvironmentFile=-${c.root}/updates/start.env\n`,
    policy: `# Only these two exact commands; no wildcard, restart, unit editing or shell.\n${c.user} ALL=(root) NOPASSWD: /usr/bin/systemctl start ${unit}, /usr/bin/systemctl stop ${unit}\n`,
  };
}
export async function readEnrollment(root: string): Promise<Enrollment> {
  const value = JSON.parse(
    await readFile(join(root, "updater.json"), "utf8"),
  ) as Enrollment;
  if (
    value.protocol !== 1 ||
    value.installation.root !== root ||
    value.installation.uid !== process.getuid?.()
  )
    throw new Error("Updater enrollment mismatch.");
  return value;
}
export async function enroll(c: Installation, version: string) {
  await validateInstallation(c);
  await validateService(c);
  if (
    existsSync(join(c.root, "updater.json")) &&
    (await readEnrollment(c.root)).helperVersion !== version
  )
    throw new Error(
      "Pinned helper upgrades require explicit operator maintenance; do not replace a running helper through enrollment.",
    );
  const files = enrollmentFiles(c, version);
  await withKernelLock(c.root, async () => {
    const lock = join(c.root, "operation.lock");
    if (existsSync(lock)) {
      if ((await readFile(lock, "utf8")) !== legacyFence)
        throw new Error(
          "Legacy CLI lock is present. Inspect that operation before enrollment.",
        );
    } else {
      await writeFile(lock, legacyFence, { flag: "wx", mode: 0o600 });
      await syncDirectory(c.root);
    }
    const directory = join(c.root, "updates");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const enrollment: Enrollment = {
      protocol: 1,
      installation: c,
      helperVersion: version,
      platform: "ubuntu-24.04-x64",
    };
    // Intent/fence survive partial setup. Repeating this explicit terminal command
    // safely reinstalls the same fixed policy; HTTP has no enrollment operation.
    await durableJson(join(c.root, "updater.json"), enrollment);
    if (!existsSync(join(directory, "gate.json")))
      await durableJson(join(directory, "gate.json"), {
        protocol: 1,
        operation: null,
        mode: "open",
      });
    for (const [name, value] of Object.entries({
      "helper.unit": files.unit,
      "app.conf": files.dropin,
      sudoers: files.policy,
    }))
      await writeFile(join(directory, name), value, { mode: 0o600 });
    await execute("/usr/sbin/visudo", ["-cf", join(directory, "sudoers")]);
    // Interactive authorization is confined to the terminal enrollment command.
    const { command } = await import("../cli/service");
    await command("sudo", ["-v"]);
    const dropin = `/etc/systemd/system/${serviceName(c)}.d`;
    await command("sudo", ["install", "-d", "-m", "755", dropin]);
    for (const [source, target, mode] of [
      ["helper.unit", `/etc/systemd/system/${files.helper}`, "644"],
      ["app.conf", `${dropin}/updater.conf`, "644"],
      ["sudoers", `/etc/sudoers.d/roost-${c.uid}-updater`, "440"],
    ])
      await command("sudo", [
        "install",
        "-o",
        "root",
        "-g",
        "root",
        "-m",
        mode!,
        join(directory, source!),
        target!,
      ]);
    await command("sudo", ["systemctl", "daemon-reload"]);
    await command("sudo", ["systemctl", "enable", files.helper]);
  });
  // Helper recovery takes the same lock; do not wait for its start while holding it.
  const { command } = await import("../cli/service");
  await command("sudo", ["systemctl", "start", files.helper]);
}
