import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";

try {
  const [origin, docsOrigin, ...flags] = process.argv.slice(2);
  assert(
    origin && docsOrigin,
    "Usage: node scripts/check-marketing-deployment.mjs MARKETING_URL DOCS_URL [--cdn]",
  );
  const website = new URL(origin).origin;
  const docs = new URL(docsOrigin).origin;
  assert(
    [website, docs].every((url) => /^https?:/.test(url)),
    "Expected HTTP(S) origins",
  );
  assert(
    flags.every((flag) => flag === "--cdn"),
    "Unknown option",
  );

  async function request(path, status, type, cache) {
    const url = new URL(path, website);
    let response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
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
    const text = await response.text();
    console.log(`${status} ${path}`);
    if (flags.includes("--cdn") && status === 200 && path !== "/healthz") {
      for (
        let attempt = 0;
        attempt < 10 && response.headers.get("x-cache") !== "HIT";
        attempt++
      ) {
        await setTimeout(2000);
        response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
        await response.arrayBuffer();
        assert.equal(response.status, status, `${path}: CDN status`);
      }
      assert.equal(
        response.headers.get("x-cache"),
        "HIT",
        `${path}: CDN cache hit`,
      );
      assert.match(
        response.headers.get("age") ?? "",
        /^\d+$/,
        `${path}: cache age`,
      );
      console.log(`CDN HIT ${path}`);
    }
    return text;
  }

  const mutable = /public, max-age=0, s-maxage=300/;
  const immutable = /max-age=31536000, immutable/;
  const html = await request("/", 200, /text\/html/, mutable);
  assert.match(html, /A home for your AI agents/);
  assert(!/__\w+__/.test(html), "Unresolved build placeholder");
  const canonical = html.match(/rel="canonical" href="([^"]+)"/)?.[1];
  assert(
    canonical && new URL(canonical).origin === website,
    "Marketing canonical URL",
  );
  for (const path of [
    "/",
    "/getting-started/",
    "/automations/",
    "/computer/",
  ]) {
    assert(html.includes(`href="${docs}${path}"`), `Docs link: ${path}`);
  }
  const script = html.match(/src="(\/assets\/[^"\s]+\.js)"/)?.[1];
  const style = html.match(/href="(\/assets\/[^"\s]+\.css)"/)?.[1];
  assert(script && style, "Missing fingerprinted assets");
  await request(script, 200, /(?:text|application)\/javascript/, immutable);
  await request(style, 200, /text\/css/, immutable);
  for (const name of ["roost", "moss", "wisp", "peach"]) {
    await request(`/${name}.svg`, 200, /image\/svg\+xml/, mutable);
  }
  const index = await request(
    "/llms.txt",
    200,
    /text\/plain; charset=utf-8/,
    mutable,
  );
  assert(
    index.includes(`${docs}/llms-full.txt`),
    "Agent index must link to deployed docs",
  );
  const example = await request(
    "/example-launch-plan.md",
    200,
    /text\/markdown; charset=utf-8/,
    mutable,
  );
  assert.match(example, /^# /m);
  await request("/healthz", 200, /text\/plain/, /no-store/);
  for (const path of [
    "/missing-marketing-smoke-test/",
    "/missing.md",
    "/assets/missing-12345678.js",
    "/.env",
    "/package.json",
  ]) {
    await request(path, 404, /text\/plain/, /no-store/);
  }
  const docsResponse = await fetch(docs, {
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(docsResponse.status, 200, "Docs home status");
  const docsHtml = await docsResponse.text();
  assert(
    docsHtml.includes(`href="${website}"`) ||
      docsHtml.includes(`href="${website}/"`),
    "Docs backlink to marketing",
  );
  console.log("Marketing deployment checks passed.");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
