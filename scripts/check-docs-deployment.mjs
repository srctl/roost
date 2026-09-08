import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";

try {
  const [origin, ...flags] = process.argv.slice(2);
  assert(origin, "Usage: node scripts/check-docs-deployment.mjs URL [--cdn]");
  const base = new URL(origin);
  assert(
    ["http:", "https:"].includes(base.protocol),
    "Expected an HTTP(S) URL",
  );
  assert(
    flags.every((flag) => flag === "--cdn"),
    "Unknown option",
  );

  async function request(path, status, type, cache) {
    const response = await fetch(new URL(path, base), {
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(response.status, status, `${path}: status`);
    assert.match(
      response.headers.get("content-type") ?? "",
      type,
      `${path}: MIME`,
    );
    assert.match(
      response.headers.get("cache-control") ?? "",
      cache,
      `${path}: cache policy`,
    );
    assert.equal(
      response.headers.get("set-cookie"),
      null,
      `${path}: public response`,
    );
    console.log(`${status} ${path}`);
    return response.text();
  }

  const mutable = /public, max-age=0, s-maxage=300/;
  const html = await request("/", 200, /text\/html/, mutable);
  const article = await request(
    "/getting-started/",
    200,
    /text\/html/,
    mutable,
  );
  assert.match(article, /Getting started/i);
  assert.notEqual(article, html, "Article must not be the home page");
  const script = html.match(/src="(\/assets\/[^"\s]+\.js)"/)?.[1];
  assert(script, "Missing fingerprinted client script");
  await request(
    script,
    200,
    /(?:text|application)\/javascript/,
    /max-age=31536000, immutable/,
  );
  await request("/assets/docs.css", 200, /text\/css/, mutable);
  for (const path of ["/llms.txt", "/llms-full.txt"]) {
    const text = await request(
      path,
      200,
      /text\/plain; charset=utf-8/,
      mutable,
    );
    assert(
      !text.trimStart().startsWith("<!DOCTYPE"),
      `${path}: must not be HTML`,
    );
  }
  const markdown = await request(
    "/getting-started.md",
    200,
    /text\/markdown; charset=utf-8/,
    mutable,
  );
  assert.match(markdown, /^# Getting started/m);
  const search = JSON.parse(
    await request("/search-index.json", 200, /application\/json/, mutable),
  );
  assert(search.some((entry) => entry.url === "/getting-started/"));
  await request("/healthz", 200, /text\/plain/, /no-store/);
  for (const path of [
    "/missing-docs-smoke-test/",
    "/missing-docs-smoke-test.md",
    "/assets/missing-12345678.js",
    "/.env",
    "/package.json",
  ]) {
    const error = await request(path, 404, /text\/html/, /no-store/);
    assert.match(error, /Page not found/i);
  }

  if (flags.includes("--cdn")) {
    for (const path of [
      "/",
      script,
      "/assets/docs.css",
      "/getting-started.md",
      "/search-index.json",
    ]) {
      let hit = false;
      for (let attempt = 0; attempt < 10; attempt++) {
        const response = await fetch(new URL(path, base), {
          signal: AbortSignal.timeout(15_000),
        });
        await response.arrayBuffer();
        assert.equal(response.status, 200, `${path}: CDN status`);
        if (response.headers.get("x-cache") === "HIT") {
          assert.match(
            response.headers.get("age") ?? "",
            /^\d+$/,
            `${path}: cache age`,
          );
          console.log(`CDN HIT ${path} (age ${response.headers.get("age")}s)`);
          hit = true;
          break;
        }
        await setTimeout(2000);
      }
      assert(
        hit,
        `${path}: no CDN HIT observed; check CDN settings and purge propagation`,
      );
    }
  }
  console.log("Docs deployment checks passed.");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
