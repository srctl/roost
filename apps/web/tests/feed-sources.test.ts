import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fetchFeedSource,
  isPublicFeedAddress,
  parseFeedXml,
  safeFeedUrl,
} from "../src/server/feed/sources.server";

const now = Date.parse("2026-09-20T12:00:00Z");
const source = {
  id: "local-news",
  name: "Local News",
  url: "https://news.example.com/feed/",
  enabled: true,
};
const lookup = async () => [{ address: "93.184.216.34", family: 4 }];
const rss = `<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>Example</title><item>
<guid isPermaLink="false">story-1</guid><title>Neighborhood &amp; transit</title><link>https://news.example.com/transit/?a=1&amp;b=2</link>
<description><![CDATA[<p>A new <strong>route</strong> &mdash; arriving soon.</p><script>steal()</script>]]></description>
<content:encoded><![CDATA[<p>The full story.</p><img src="/photos/bus.jpg"><style>secret</style>]]></content:encoded>
<pubDate>Sun, 20 Sep 2026 10:00:00 GMT</pubDate><category>Seattle</category><category>Transit</category>
</item></channel></rss>`;

test("RSS preserves source attribution and article URLs while making HTML inert", () => {
  const items = parseFeedXml(rss, source, { now });
  assert.equal(items.length, 1);
  assert.deepEqual(items[0], {
    externalId: "story-1",
    title: "Neighborhood & transit",
    summary: "A new route — arriving soon.",
    body: "The full story.",
    url: "https://news.example.com/transit/?a=1&b=2",
    imageUrl: "https://news.example.com/photos/bus.jpg",
    sourceName: "Local News",
    sourceUrl: source.url,
    publishedAt: Date.parse("2026-09-20T10:00:00Z"),
    topics: ["Seattle", "Transit"],
  });
});

test("Atom handles alternate links, XHTML content, categories and bad or future dates", () => {
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Updates</title>
<entry><id>tag:example.com,2026:a</id><title type="html">A &amp; B</title><link rel="self" href="/api/1"/><link rel="alternate" href="/stories/1"/>
<content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>Opened today.</p><script>bad()</script></div></content><category term="Capitol Hill"/><updated>2099-01-01T00:00:00Z</updated></entry>
<entry><title>Another</title><link href="/stories/2"/><summary>Another summary</summary><published>not-a-date</published></entry></feed>`;
  const items = parseFeedXml(xml, source, { now });
  assert.equal(items.length, 2);
  assert.equal(items[0].url, "https://news.example.com/stories/1");
  assert.equal(items[0].body, "Opened today.");
  assert.equal(items[0].publishedAt, now);
  assert.deepEqual(items[0].topics, ["Capitol Hill"]);
  assert.equal(items[1].publishedAt, now);
});

test("unsafe article links are dropped; unsafe images do not survive parsing", () => {
  const xml = `<rss><channel>
<item><title>Unsafe</title><link>javascript:alert(1)</link></item>
<item><title>Private</title><link>http://127.0.0.1/secret</link></item>
<item><title>Valid</title><link>https://news.example.com/ok</link><enclosure type="image/png" url="http://169.254.169.254/latest"/></item>
<item><title>Duplicate</title><link>https://news.example.com/ok</link></item>
</channel></rss>`;
  const items = parseFeedXml(xml, source, { now });
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Valid");
  assert.equal(items[0].imageUrl, null);
});

test("publisher hero images survive RSS media, Atom enclosures and structured XHTML content", () => {
  const samples = [
    {
      xml: '<rss xmlns:media="http://search.yahoo.com/mrss/"><channel><item><title>Media story</title><link>https://news.example.com/story</link><media:group><media:content medium="image" url="https://images.example.com/hero.jpg"/></media:group></item></channel></rss>',
      image: "https://images.example.com/hero.jpg",
    },
    {
      xml: '<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Enclosed image</title><link href="https://news.example.com/story"/><link rel="enclosure" type="audio/mpeg" href="/podcast.mp3"/><link rel="enclosure" type="image/jpeg" href="/photos/hero.jpg"/></entry></feed>',
      image: "https://news.example.com/photos/hero.jpg",
    },
    {
      xml: '<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>XHTML image</title><link href="https://news.example.com/story"/><content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>Story text</p><img src="/photos/neighborhood.jpg"/></div></content></entry></feed>',
      image: "https://news.example.com/photos/neighborhood.jpg",
    },
    {
      xml: '<rss xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><item><title>Summary image</title><link>https://news.example.com/story</link><content:encoded>Text without an image.</content:encoded><description><![CDATA[<img src="http://127.0.0.1/private"><img src="/photos/summary.jpg">]]></description></item></channel></rss>',
      image: "https://news.example.com/photos/summary.jpg",
    },
  ];
  for (const sample of samples)
    assert.equal(
      parseFeedXml(sample.xml, source, { now })[0]?.imageUrl,
      sample.image,
    );
  const noImage =
    '<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>No suitable image</title><link href="https://news.example.com/story"/><link rel="enclosure" type="audio/mpeg" href="/podcast.mp3"/><content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><img src="http://169.254.169.254/private"/><p>Text remains readable</p></div></content></entry></feed>';
  const item = parseFeedXml(noImage, source, { now })[0]!;
  assert.equal(item.imageUrl, null);
  assert.equal(item.body, "Text remains readable");
});

test("rejects malformed XML, HTML responses, DTDs and entity-expansion documents", () => {
  for (const xml of [
    "<rss><channel></rss>",
    "<html><body>Sign in</body></html>",
    '<!DOCTYPE rss [<!ENTITY x "abc">]><rss><channel><title>&x;</title></channel></rss>',
    '<!DOCTYPE rss SYSTEM "file:///etc/passwd"><rss/>',
  ]) {
    assert.throws(() => parseFeedXml(xml, source), /feed|Feeds/);
  }
  assert.throws(
    () =>
      parseFeedXml(
        `<rss><channel>${"<item>".repeat(100)}${"</item>".repeat(100)}</channel></rss>`,
        source,
      ),
    /valid RSS or Atom/,
  );
});

test("public address checks reject private, mapped, special and ambiguous IP formats", () => {
  for (const value of [
    "127.0.0.1",
    "10.1.2.3",
    "169.254.169.254",
    "172.31.1.1",
    "192.168.1.1",
    "100.100.100.200",
    "198.19.0.1",
    "192.0.2.1",
    "224.1.1.1",
    "0.0.0.0",
    "::1",
    "fe80::1",
    "fc00::1",
    "::ffff:127.0.0.1",
    "2002:7f00:1::",
    "2001:db8::1",
  ]) {
    assert.equal(isPublicFeedAddress(value), false, value);
  }
  for (const value of [
    "93.184.216.34",
    "8.8.8.8",
    "2606:4700:4700::1111",
    "2001:4860:4860::8888",
  ])
    assert.equal(isPublicFeedAddress(value), true, value);
  for (const value of [
    "http://2130706433/rss",
    "http://0x7f000001/rss",
    "http://127.1/rss",
    "http://user:pass@public.example.com/rss",
    "file:///tmp/feed",
    "https://localhost/rss",
    "http://printer.local/rss",
    "https://public.example.com:8443/rss",
  ])
    assert.equal(safeFeedUrl(value), null, value);
});

test("DNS answers are validated before any request, including mixed public and private answers", async () => {
  let requests = 0;
  await assert.rejects(
    fetchFeedSource(source, {
      lookup: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.1", family: 4 },
      ],
      fetch: async () => {
        requests++;
        return new Response(rss);
      },
    }),
    /public internet/,
  );
  assert.equal(requests, 0);
});

test("redirects are checked again and private destinations never receive a request", async () => {
  const requested: string[] = [];
  await assert.rejects(
    fetchFeedSource(source, {
      lookup,
      fetch: async (input) => {
        requested.push(String(input));
        return new Response(null, {
          status: 302,
          headers: { location: "http://169.254.169.254/latest/meta-data" },
        });
      },
    }),
    /public HTTP/,
  );
  assert.deepEqual(requested, [source.url]);
  await assert.rejects(
    fetchFeedSource(source, {
      lookup,
      fetch: async () =>
        new Response(null, {
          status: 302,
          headers: { location: "http://news.example.com/feed/" },
        }),
    }),
    /insecure/,
  );
});

test("uses validators and preserves them on 304 without parsing a body", async () => {
  const result = await fetchFeedSource(
    { ...source, etag: '"v1"', lastModified: "Sun, 20 Sep 2026 10:00:00 GMT" },
    {
      lookup,
      fetch: async (_input, init) => {
        const headers = new Headers(init?.headers);
        assert.equal(headers.get("if-none-match"), '"v1"');
        assert.equal(
          headers.get("if-modified-since"),
          "Sun, 20 Sep 2026 10:00:00 GMT",
        );
        assert.equal(init?.redirect, "manual");
        return new Response(null, { status: 304 });
      },
    },
  );
  assert.deepEqual(result, {
    items: [],
    etag: '"v1"',
    lastModified: "Sun, 20 Sep 2026 10:00:00 GMT",
    notModified: true,
  });
});

test("does not leak cache validators across origins and stores successful new validators", async () => {
  let calls = 0;
  const result = await fetchFeedSource(
    { ...source, etag: '"private-value"' },
    {
      lookup,
      now,
      fetch: async (_url, init) => {
        calls++;
        if (calls === 1)
          return new Response(null, {
            status: 301,
            headers: { location: "https://feeds.example.com/rss" },
          });
        assert.equal(new Headers(init?.headers).has("if-none-match"), false);
        return new Response(rss, {
          headers: {
            etag: '"new"',
            "last-modified": "Sun, 20 Sep 2026 11:00:00 GMT",
          },
        });
      },
    },
  );
  assert.equal(result.etag, '"new"');
  assert.equal(result.notModified, false);
  assert.equal(result.items.length, 1);
});

test("bounds streamed bodies without trusting Content-Length and cancels on overflow", async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("x".repeat(64)));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    fetchFeedSource(source, {
      lookup,
      maxBytes: 32,
      fetch: async () => new Response(body),
    }),
    /size limit/,
  );
  assert.equal(cancelled, true);
});

test("bounds stalled DNS and stalled response bodies and does not leak transport errors", async () => {
  await assert.rejects(
    fetchFeedSource(source, {
      timeoutMs: 5,
      lookup: () => new Promise(() => {}),
    }),
    /timed out/,
  );
  let cancelled = false;
  await assert.rejects(
    fetchFeedSource(source, {
      lookup,
      timeoutMs: 5,
      fetch: async () =>
        new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
        ),
    }),
    /timed out/,
  );
  assert.equal(cancelled, true);
  await assert.rejects(
    fetchFeedSource(source, {
      lookup,
      fetch: async () => {
        throw new Error("secret password: abc");
      },
    }),
    (error: Error) =>
      !error.message.includes("secret") &&
      /could not be loaded/.test(error.message),
  );
});
