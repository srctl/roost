import assert from "node:assert/strict";
import { test } from "node:test";
import { followStartupRedirect } from "../src/server/startup-response.server";

const agentPath = "/agents/11111111-2222-4333-8444-555555555555";

test("renders remembered-agent launches with the original request context", async () => {
  const controller = new AbortController();
  const request = new Request("https://roost.test/", {
    headers: { Cookie: "last-agent=saved", Authorization: "Bearer fixture" },
    signal: controller.signal,
  });
  const rendered = new Response("conversation", {
    headers: { "Cache-Control": "private, no-store" },
  });
  let next: Request | undefined;
  const result = await followStartupRedirect(
    request,
    Response.redirect(`https://roost.test${agentPath}`, 307),
    (forwarded) => {
      next = forwarded;
      return rendered;
    },
  );
  assert.equal(result, rendered);
  assert.equal(next?.url, `https://roost.test${agentPath}`);
  assert.equal(next?.headers.get("Cookie"), "last-agent=saved");
  assert.equal(next?.headers.get("Authorization"), "Bearer fixture");
  controller.abort();
  assert.equal(next?.signal.aborted, true);
});

test("preserves redirects with query, cookie, or destination semantics", async () => {
  const cases = [
    ["https://roost.test/?new", agentPath, {}],
    ["https://roost.test/", agentPath, { "Set-Cookie": "session=changed" }],
    ["https://roost.test/", `https://other.test${agentPath}`, {}],
    ["https://roost.test/", `${agentPath}?view=files`, {}],
    ["https://roost.test/", "/login", {}],
  ] as const;
  for (const [url, location, headers] of cases) {
    const response = new Response(null, {
      status: 307,
      headers: { Location: location, ...headers },
    });
    const result = await followStartupRedirect(
      new Request(url),
      response,
      () => {
        throw new Error("Unexpected internal render");
      },
    );
    assert.equal(result, response);
  }
});
