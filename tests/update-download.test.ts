import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
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
import { stageArtifact } from "../src/updater/artifact";
import { parseOffer } from "../src/updater/releases";

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
