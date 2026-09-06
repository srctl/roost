import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const root = resolve(import.meta.dirname, "..");
const pins = JSON.parse(
  readFileSync(join(root, "scripts/runtime-versions.json"), "utf8"),
);
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = process.env.ROOST_VERSION ?? pkg.version;
const repository =
  process.env.ROOST_REPOSITORY ?? process.env.GITHUB_REPOSITORY;
if (!/^\d+\.\d+\.\d+$/.test(version))
  throw new Error("ROOST_VERSION must be a stable version such as 0.1.0.");
if (repository && !/^[\w.-]+\/[\w.-]+$/.test(repository))
  throw new Error("ROOST_REPOSITORY must be owner/repo.");
const output = join(root, "dist");
const bundle = join(output, "release");
const cache =
  process.env.ROOST_RUNTIME_CACHE ?? join(tmpdir(), "roost-runtime-cache");
for (const file of [".output/server/index.mjs", ".output/cli/roost.mjs"]) {
  if (!existsSync(join(root, file)))
    throw new Error("Run pnpm build before packaging a release.");
}
mkdirSync(cache, { recursive: true });
rmSync(bundle, { recursive: true, force: true });
mkdirSync(join(bundle, "runtime"), { recursive: true });
function download(url, path) {
  execFileSync(
    "curl",
    [
      "--fail",
      "--location",
      "--silent",
      "--show-error",
      "--retry",
      "3",
      url,
      "--output",
      path,
    ],
    { stdio: "inherit" },
  );
}
for (const [name, pin] of Object.entries(pins)) {
  const archive = join(cache, `${name}.tar.gz`);
  if (!existsSync(archive)) download(pin.url, archive);
  if (
    createHash("sha256").update(readFileSync(archive)).digest("hex") !==
    pin.sha256
  )
    throw new Error(`Wrong ${name} checksum. Remove ${archive} and retry.`);
  const unpacked = join(cache, `${name}-${pin.version}`);
  rmSync(unpacked, { recursive: true, force: true });
  mkdirSync(unpacked, { recursive: true });
  execFileSync(
    "tar",
    [
      "-xzf",
      archive,
      "-C",
      unpacked,
      ...(name === "node" ? ["--strip-components=1"] : []),
    ],
    { stdio: "inherit" },
  );
  if (name === "node") {
    cpSync(join(unpacked, "bin/node"), join(bundle, "runtime/node"));
    cpSync(join(unpacked, "LICENSE"), join(bundle, "runtime/node-LICENSE"));
  } else
    cpSync(unpacked, join(bundle, "runtime/codex"), {
      recursive: true,
      dereference: true,
    });
}
// Runtime and dependency licenses travel with the distribution.
for (const notice of ["LICENSE", "NOTICE"]) {
  const path = join(cache, `codex-${pins.codex.version}-${notice}`);
  if (!existsSync(path))
    download(
      `https://raw.githubusercontent.com/openai/codex/rust-v${pins.codex.version}/${notice}`,
      path,
    );
  cpSync(path, join(bundle, "runtime/codex", notice));
}
for (const [source, target] of [
  [".output/server", "app/server"],
  [".output/public", "app/public"],
  [".output/cli", "cli"],
  ["bin", "bin"],
]) {
  cpSync(join(root, source), join(bundle, target), {
    recursive: true,
    dereference: true,
  });
}
cpSync(join(root, "LICENSE"), join(bundle, "LICENSE"));
const licenses = join(bundle, "licenses");
mkdirSync(licenses, { recursive: true });
function copyLicenses(packageDir, name) {
  if (!existsSync(packageDir)) return;
  const manifest = join(packageDir, "package.json");
  const version = existsSync(manifest)
    ? JSON.parse(readFileSync(manifest, "utf8")).version
    : "unknown";
  for (const file of readdirSync(packageDir)) {
    if (/^(licen[sc]e|notice|copyright)(\.|$)/i.test(file)) {
      const destination = join(
        licenses,
        `${name.replaceAll("/", "__")}@${version}`,
      );
      mkdirSync(destination, { recursive: true });
      cpSync(join(packageDir, file), join(destination, file), {
        recursive: true,
        dereference: true,
      });
    }
  }
}
// Handle both flat node_modules and pnpm's virtual store.
function scanModules(modules) {
  if (!existsSync(modules)) return;
  for (const name of readdirSync(modules)) {
    if (name.startsWith(".")) continue;
    if (name.startsWith("@"))
      for (const child of readdirSync(join(modules, name)))
        copyLicenses(join(modules, name, child), `${name}/${child}`);
    else copyLicenses(join(modules, name), name);
  }
}
scanModules(join(root, "node_modules"));
const store = join(root, "node_modules/.pnpm");
if (existsSync(store))
  for (const entry of readdirSync(store))
    scanModules(join(store, entry, "node_modules"));
cpSync(
  join(root, "THIRD_PARTY_NOTICES.md"),
  join(bundle, "THIRD_PARTY_NOTICES.md"),
);
writeFileSync(
  join(bundle, "release.json"),
  JSON.stringify(
    {
      version,
      platform: "linux",
      arch: "x64",
      node: pins.node.version,
      codex: pins.codex.version,
      schema: 1,
      ...(repository ? { repository } : {}),
    },
    null,
    2,
  ) + "\n",
);
const archive = join(output, "roost-linux-x64.tar.gz");
execFileSync(
  "tar",
  [
    ...(process.platform === "darwin"
      ? ["--no-xattrs", "--no-mac-metadata"]
      : []),
    "-czf",
    archive,
    "-C",
    bundle,
    ".",
  ],
  {
    stdio: "inherit",
    env: { ...process.env, COPYFILE_DISABLE: "1" },
  },
);
writeFileSync(
  join(output, "SHA256SUMS"),
  `${createHash("sha256").update(readFileSync(archive)).digest("hex")}  roost-linux-x64.tar.gz\n`,
);
cpSync(join(root, "scripts/install.sh"), join(output, "install.sh"));
console.log(`Packaged Roost ${version}: ${archive}`);
