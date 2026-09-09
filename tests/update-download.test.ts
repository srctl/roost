import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { activate } from "../src/cli/releases";
import { readSchemaVersions, stageArtifact } from "../src/updater/artifact";
import { parseOffer } from "../src/updater/releases";

test("staging schema reads wait for transient writers and bound persistent contention", async () => {
  const root = await mkdtemp("/tmp/roost-schema-lock-");
  try {
    await mkdir(join(root, "data"));
    for (const name of ["roost.sqlite", "auth.sqlite"]) {
      const db = new DatabaseSync(join(root, "data", name));
      db.exec(`PRAGMA user_version=${name === "roost.sqlite" ? 10 : 0}`);
      db.close();
    }
    for (const [name, transient] of [
      ["roost.sqlite", true],
      ["auth.sqlite", true],
      ["auth.sqlite", false],
    ] as const) {
      const writer = spawn(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `import {DatabaseSync} from 'node:sqlite';
         const db=new DatabaseSync(process.argv[1]);
         db.exec('BEGIN EXCLUSIVE');
         process.stdout.write('locked\\n');
         process.stdin.once('data',()=>setTimeout(()=>{db.exec('COMMIT');db.close();process.exit(0)},200));`,
          join(root, "data", name),
        ],
        { stdio: ["pipe", "pipe", "ignore"] },
      );
      const exited = once(writer, "exit");
      try {
        assert.equal(
          String((await once(writer.stdout!, "data"))[0]),
          "locked\n",
        );
        if (transient) writer.stdin!.write("release\n");
        const start = Date.now();
        if (transient) {
          assert.deepEqual(readSchemaVersions(root), { app: 10, auth: 0 });
          assert.ok(
            Date.now() - start >= 100,
            "The actual writer lock was reached",
          );
        } else {
          assert.throws(() => readSchemaVersions(root), /database is locked/);
          assert.ok(Date.now() - start >= 4500);
          assert.ok(Date.now() - start < 10000);
        }
      } finally {
        if (!transient && writer.exitCode === null)
          writer.stdin!.end("release\n");
        await exited;
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("pinned download validates identity/digest/manifest and strips credentials on trusted redirects", async () => {
  const root = await mkdtemp("/tmp/roost-download-");
  const compatibility = {
    protocol: 1,
    startupGate: 1,
    app: { min: 10, max: 10, output: 10 },
    auth: { min: 0, max: 0, output: 0 },
    data: "complete-snapshot-v1",
    externalState: "unchanged",
    codex: "0.153.4",
  };
  const manifest = {
    schema: 1,
    version: "0.1.40",
    platform: "linux",
    arch: "x64",
    node: "24.15.0",
    codex: "0.153.4",
  };
  try {
    await mkdir(join(root, "data"));
    for (const name of ["roost.sqlite", "auth.sqlite"]) {
      const db = new DatabaseSync(join(root, "data", name));
      db.exec(`PRAGMA user_version=${name === "roost.sqlite" ? 10 : 0}`);
      db.close();
    }
    for (const version of ["0.1.40", "0.1.41"]) {
      const target = join(
        root,
        version === "0.1.40" ? "releases" : "fixture",
        version,
      );
      for (const [path, contents] of Object.entries({
        "release.json": JSON.stringify({ ...manifest, version }),
        "compatibility.json": JSON.stringify(compatibility),
        "runtime/node": "#!/bin/sh\necho v24.15.0\n",
        "runtime/codex/bin/codex": "#!/bin/sh\necho codex-cli 0.153.4\n",
        "cli/roost.mjs": "export {};",
        "app/server/index.mjs": "export {};",
        "bin/roost": "#!/bin/sh\n",
      })) {
        await mkdir(join(target, path, ".."), { recursive: true });
        await writeFile(join(target, path), contents);
        await chmod(join(target, path), 0o700);
      }
    }
    await activate(root, join(root, "releases", "0.1.40"));
    const archive = join(root, "fixture.tar.gz");
    execFileSync("tar", [
      "--format=gnu",
      "-czf",
      archive,
      "-C",
      join(root, "fixture", "0.1.41"),
      ".",
    ]);
    const bytes = await readFile(archive);
    const metadata = {
      id: 1,
      tag_name: "v0.1.41",
      draft: false,
      prerelease: false,
      assets: [
        {
          id: 2,
          name: "roost-linux-x64.tar.gz",
          size: bytes.length,
          digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
          url: "https://api.github.com/repos/srctl/roost/releases/assets/2",
        },
      ],
    };
    const offer = parseOffer(metadata, "srctl/roost", Date.now());
    for (const mode of [
      "changed",
      "evil-redirect",
      "bad-digest",
      "success",
      "retry",
    ] as const) {
      let calls = 0;
      const fetcher = (async (url, init) => {
        calls++;
        if (calls === 1)
          return Response.json(
            mode === "changed"
              ? {
                  ...metadata,
                  assets: [
                    {
                      ...metadata.assets[0],
                      id: 3,
                      url: "https://api.github.com/repos/srctl/roost/releases/assets/3",
                    },
                  ],
                }
              : metadata,
          );
        if (calls === 2) {
          assert.equal(
            new Headers(init?.headers).get("authorization"),
            "Bearer private-token",
          );
          return new Response(null, {
            status: 302,
            headers: {
              location:
                mode === "evil-redirect"
                  ? "https://evil.example/payload"
                  : "https://release-assets.githubusercontent.com/payload",
            },
          });
        }
        assert.equal(
          String(url),
          "https://release-assets.githubusercontent.com/payload",
        );
        assert.equal(new Headers(init?.headers).get("authorization"), null);
        return new Response(
          mode === "bad-digest" ? Buffer.alloc(bytes.length) : bytes,
        );
      }) as typeof fetch;
      const id = randomUUID();
      await mkdir(join(root, "updates", id), { recursive: true });
      const run = stageArtifact(
        root,
        offer,
        id,
        resolve("src/updater"),
        new AbortController().signal,
        () => {},
        "private-token",
        fetcher,
      );
      if (["success", "retry"].includes(mode)) await run;
      else await assert.rejects(run);
      assert.equal(
        await readFile(join(root, "current", "release.json"), "utf8"),
        JSON.stringify(manifest),
      );
    }
    const fixture = join(root, "fixture", "0.1.41");
    const validManifest = { ...manifest, version: "0.1.41" };
    for (const [name, file, contents, error] of [
      [
        "tag",
        "release.json",
        JSON.stringify({ ...validManifest, version: "0.1.42" }),
        /Manifest\/tag mismatch/,
      ],
      [
        "platform",
        "release.json",
        JSON.stringify({ ...validManifest, arch: "arm64" }),
        /invalid Roost release manifest/,
      ],
      [
        "protocol",
        "compatibility.json",
        JSON.stringify({ ...compatibility, protocol: 2 }),
        /compatibility contract/,
      ],
      [
        "app schema",
        "compatibility.json",
        JSON.stringify({
          ...compatibility,
          app: { min: 11, max: 11, output: 11 },
        }),
        /Database or bundled Codex compatibility/,
      ],
      [
        "auth schema",
        "compatibility.json",
        JSON.stringify({
          ...compatibility,
          auth: { min: 1, max: 1, output: 1 },
        }),
        /Database or bundled Codex compatibility/,
      ],
      [
        "Codex",
        "compatibility.json",
        JSON.stringify({ ...compatibility, codex: "0.154.0" }),
        /Database or bundled Codex compatibility/,
      ],
      [
        "startup gate",
        "compatibility.json",
        JSON.stringify({ ...compatibility, startupGate: 0 }),
        /startup verification gate/,
      ],
      [
        "runtime version substring",
        "runtime/node",
        "#!/bin/sh\necho v124.15.0\n",
        /Bundled runtime cannot execute/,
      ],
      ["runtime ABI", "runtime/node", "#!/unavailable-abi-interpreter\n", /./],
    ] as const) {
      const original = await readFile(join(fixture, file));
      try {
        await writeFile(join(fixture, file), contents);
        execFileSync("tar", [
          "--format=gnu",
          "-czf",
          archive,
          "-C",
          fixture,
          ".",
        ]);
        const payload = await readFile(archive);
        const release = {
          ...metadata,
          assets: [
            {
              ...metadata.assets[0]!,
              size: payload.length,
              digest: `sha256:${createHash("sha256").update(payload).digest("hex")}`,
            },
          ],
        };
        const invalid = parseOffer(release, "srctl/roost", Date.now());
        const id = randomUUID();
        await mkdir(join(root, "updates", id), { recursive: true });
        let calls = 0;
        const fetcher = (async () =>
          ++calls === 1
            ? Response.json(release)
            : new Response(payload)) as typeof fetch;
        await assert.rejects(
          stageArtifact(
            root,
            invalid,
            id,
            resolve("src/updater"),
            new AbortController().signal,
            () => {},
            undefined,
            fetcher,
          ),
          error,
          name,
        );
        assert.equal(
          calls,
          2,
          `${name}: artifact must reach actual validation`,
        );
        assert.equal(
          await readFile(join(root, "current", "release.json"), "utf8"),
          JSON.stringify(manifest),
        );
      } finally {
        await writeFile(join(fixture, file), original);
      }
    }
    for (const prior of [
      { ...compatibility, app: { min: 0, max: 9, output: 9 } },
      { ...compatibility, codex: "0.154.0" },
    ]) {
      await writeFile(
        join(root, "current", "compatibility.json"),
        JSON.stringify(prior),
      );
      const id = randomUUID();
      await mkdir(join(root, "updates", id), { recursive: true });
      let calls = 0;
      const fetcher = (async () =>
        ++calls === 1
          ? Response.json(metadata)
          : new Response(bytes)) as typeof fetch;
      await assert.rejects(
        stageArtifact(
          root,
          offer,
          id,
          resolve("src/updater"),
          new AbortController().signal,
          () => {},
          undefined,
          fetcher,
        ),
        /Database or bundled Codex compatibility/,
      );
    }
    await writeFile(
      join(root, "current", "compatibility.json"),
      JSON.stringify(compatibility),
    );
    assert.equal(
      JSON.parse(
        await readFile(
          join(root, "releases", "0.1.41", "release.json"),
          "utf8",
        ),
      ).version,
      "0.1.41",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
