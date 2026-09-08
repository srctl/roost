import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Effect } from "effect";
import { AuthStore } from "../server/auth/store.server";
import {
  activate,
  downloadRelease,
  installRelease,
  readRelease,
} from "./releases";
import {
  command,
  type Installation,
  isActive,
  service,
  serviceName,
  serviceUnit,
  waitForServer,
} from "./service";
import { readJson, withLock } from "./state";
import { applyUpdate } from "./update";

const root = resolve(
  process.env.ROOST_HOME ?? join(homedir(), ".local/share/roost"),
);

const configPath = join(root, "config.json");
const bundle = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const help = `Roost

  roost setup [--repository owner/repo] [--port 3000] [--skip-login]
  roost setup --login                 Sign in with the bundled Codex
  roost update [--version 0.1.0]
  roost auth setup --origin https://roost.example.com
  roost auth recover [--origin https://roost.example.com]
  roost server start
  roost server stop
  roost server logs [--follow]

Linux x64 with systemd. Setup installs a service under your account using sudo.
Data and releases: ROOST_HOME (default ~/.local/share/roost).
The listener stays on 127.0.0.1; use an SSH tunnel for remote access.
`;

function flags(args: string[], allowed: Record<string, "value" | "flag">) {
  const values: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const name = args[i]!;
    if (!allowed[name] || values[name] !== undefined)
      throw new Error(`Unexpected argument: ${name}`);
    if (allowed[name] === "flag") values[name] = "true";
    else {
      const value = args[++i];
      if (!value || value.startsWith("--"))
        throw new Error(`Missing value for ${name}.`);
      values[name] = value;
    }
  }

  return values;
}

async function config() {
  if (!existsSync(configPath))
    throw new Error("Run roost setup from an extracted release first.");
  const result = await readJson<Installation>(configPath);
  if (result.root !== root || result.uid !== userInfo().uid)
    throw new Error("This installation belongs to another path or user.");
  return result;
}

async function start(c: Installation) {
  await service(c, "start");
  const release = await readRelease(join(root, "current"));
  await waitForServer(c, release.version);
  console.log(
    `Roost ${release.version} is running at http://127.0.0.1:${c.port}`,
  );
}

async function login(c: Installation) {
  process.env.CODEX_HOME = join(c.home, ".codex");
  await command(join(root, "current/runtime/codex/bin/codex"), [
    "login",
    "--device-auth",
    "-c",
    'cli_auth_credentials_store="file"',
  ]);
  console.log(`Codex sign-in is stored for ${c.user}.`);
}

async function setup(options: Record<string, string>) {
  const user = userInfo();
  const old = existsSync(configPath) ? await config() : undefined;
  if (options["--login"]) {
    if (!old) throw new Error("Run roost setup first.");
    await login(old);

    return;
  }
  const release = await readRelease(bundle);
  const port = Number(options["--port"] ?? old?.port ?? 3000);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("Choose a port between 1024 and 65535.");
  const repository =
    options["--repository"] ?? old?.repository ?? release.repository;
  if (repository && !/^[\w.-]+\/[\w.-]+$/.test(repository))
    throw new Error("Use owner/repository for the GitHub repository.");
  const c: Installation = {
    root,
    user: user.username,
    uid: user.uid,
    home: homedir(),
    port,
    ...(repository ? { repository } : {}),
  };
  if (!/^[a-z_][a-z0-9_-]*\$?$/i.test(c.user) || /[\r\n\0]/.test(root + c.home))
    throw new Error("Unsupported service user or installation path.");
  const unitPath = `/etc/systemd/system/${serviceName(c)}`;
  if (
    existsSync(unitPath) &&
    !(await readFile(unitPath, "utf8")).includes(`ROOST_HOME=${root}`)
  )
    throw new Error(`${unitPath} already belongs to another installation.`);
  const bin = join(c.home, ".local/bin");
  const launcher = join(bin, "roost");
  const target = join(root, "current/bin/roost");
  try {
    if ((await readlink(launcher)) !== target)
      throw new Error(`${launcher} already exists and was not replaced.`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (
    old &&
    (await readRelease(join(root, "current"))).version !== release.version
  )
    throw new Error(
      "Use roost update to change an existing installation's version.",
    );
  // Resolve sudo before changing the installation; never run Roost itself as root.
  await command("sudo", ["-v"]);
  const destination = join(root, "releases", release.version);
  if (!existsSync(destination)) await installRelease(root, bundle);
  else await readRelease(destination);
  if (old && (await isActive(old))) await service(old, "stop");
  await activate(root, destination);
  await mkdir(join(root, "data"), { recursive: true, mode: 0o700 });
  await writeFile(`${configPath}.new`, `${JSON.stringify(c, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(`${configPath}.new`, configPath);
  const unit = join(root, "service.unit");
  await writeFile(unit, serviceUnit(c), { mode: 0o600 });
  await command("sudo", ["install", "-m", "644", unit, unitPath]);
  await command("sudo", ["systemctl", "daemon-reload"]);
  await service(c, "enable");
  await mkdir(bin, { recursive: true });
  if (!existsSync(launcher))
    await symlink(join(root, "current/bin/roost"), launcher);
  if (
    !options["--skip-login"] &&
    !existsSync(join(c.home, ".codex/auth.json"))
  ) {
    if (process.stdin.isTTY) await login(c);
    else console.log("Sign in later with roost setup --login.");
  }
  await start(c);
  console.log(
    `Installed ${launcher}. Add ~/.local/bin to PATH if needed. Data: ${join(root, "data")}`,
  );
}

async function update(options: Record<string, string>) {
  const c = await config();
  if (!c.repository)
    throw new Error(
      "No release repository configured. Run roost setup --repository owner/repo --skip-login first.",
    );
  const previous = await realpath(join(root, "current"));
  const old = await readRelease(previous);
  const staging = await mkdtemp(join(root, "download-"));
  const abort = new AbortController();

  const interrupt = () => abort.abort(new Error("Update interrupted."));

  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    console.log("Downloading and verifying release…");
    const unpacked = await downloadRelease(
      c.repository,
      staging,
      options["--version"],
    );
    const next = await readRelease(unpacked);
    if (next.version === old.version) {
      console.log(`Already on Roost ${old.version}.`);

      return;
    }
    const a = next.version.split(".").map(Number),
      b = old.version.split(".").map(Number);
    const first = a.findIndex((n, i) => n !== b[i]);
    if (first < 0 || a[first]! < b[first]!)
      throw new Error("Downgrades are not supported by roost update.");
    if (existsSync(join(root, "releases", next.version)))
      throw new Error(
        "That release directory already exists; inspect it before retrying.",
      );
    const installed = await installRelease(root, unpacked);
    abort.signal.throwIfAborted();
    await command("sudo", ["-v"]);
    await applyUpdate(
      root,
      previous,
      installed.destination,
      {
        isActive: () => isActive(c),
        start: () => service(c, "start"),
        stop: () => service(c, "stop"),
        healthy: (version) => waitForServer(c, version),
      },
      abort.signal,
    );
  } finally {
    await rm(staging, { recursive: true, force: true });
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
  }
}

async function main() {
  const [action, ...args] = process.argv.slice(2);
  if (!action || action === "--help" || action === "help") {
    console.log(help);

    return;
  }
  if (action === "--version") {
    console.log((await readRelease(bundle)).version);

    return;
  }
  if (action === "auth") {
    const [operation, ...rest] = args;
    if (operation !== "setup" && operation !== "recover")
      throw new Error("Use roost auth setup or recover.");
    const options = flags(rest, { "--origin": "value" });
    if (operation === "setup" && !options["--origin"])
      throw new Error("Specify --origin https://your-host.");
    const store = new AuthStore(
      resolve(process.env.ROOST_DATA_DIR ?? join(root, "data")),
    );
    try {
      const link = store.setup(options["--origin"], operation === "recover");
      console.log(
        "Open this private, single-use link within 15 minutes to register your passkey:",
      );
      console.log(link);
      if (operation === "recover")
        console.log("Previous passkeys and sessions were revoked.");
    } finally {
      store.close();
    }
    return;
  }
  if (process.platform !== "linux" || process.arch !== "x64")
    throw new Error("This first release supports Linux x64 with systemd.");
  if (userInfo().uid === 0)
    throw new Error(
      "Run roost as your normal user, not root. It uses sudo only for service management.",
    );
  if (action === "setup") {
    const options = flags(args, {
      "--repository": "value",
      "--port": "value",
      "--skip-login": "flag",
      "--login": "flag",
    });
    await withLock(root, () => setup(options));

    return;
  }
  if (action === "update") {
    const options = flags(args, { "--version": "value" });
    await withLock(root, () => update(options));

    return;
  }
  if (action !== "server")
    throw new Error(`Unknown command: ${action}. Run roost --help.`);
  const [operation, ...rest] = args;
  const options = flags(
    rest,
    operation === "logs" ? { "--follow": "flag" } : {},
  );
  const c = await config();
  if (operation === "run") {
    const release = await readRelease(bundle);
    process.env.HOST = "127.0.0.1";
    process.env.NITRO_HOST = "127.0.0.1";
    process.env.PORT = String(c.port);
    process.env.NITRO_PORT = String(c.port);
    process.env.ROOST_DATA_DIR = join(root, "data");
    process.env.ROOST_CODEX_BINARY = join(bundle, "runtime/codex/bin/codex");
    process.env.CODEX_HOME = join(c.home, ".codex");
    process.env.ROOST_RELEASE_VERSION = release.version;
    await import(
      /* @vite-ignore */ pathToFileURL(join(bundle, "app/server/index.mjs"))
        .href
    );

    return;
  }
  if (operation === "logs") {
    await command("sudo", [
      "journalctl",
      "-u",
      serviceName(c),
      "-n",
      "100",
      ...(options["--follow"] ? ["--follow"] : ["--no-pager"]),
    ]);

    return;
  }
  if (operation === "start") {
    await withLock(root, () => start(c));

    return;
  }
  if (operation === "stop") {
    await withLock(root, async () => {
      await service(c, "stop");
      console.log(
        "Roost stopped. Active work is interrupted; saved conversations and queued work remain.",
      );
    });

    return;
  }
  throw new Error("Use roost server start, stop, or logs.");
}

Effect.runPromise(
  Effect.tryPromise({
    try: main,
    catch: (error) =>
      error instanceof Error ? error : new Error(String(error)),
  }).pipe(
    Effect.catchAll((error) =>
      Effect.sync(() => {
        console.error(error.message);
        process.exitCode = 1;
      }),
    ),
  ),
);
