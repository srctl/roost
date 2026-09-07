import assert from "node:assert/strict";
import test from "node:test";
import { type Document, renderPage } from "./src/render";

const options = {
  websiteUrl: "https://roost.example.com",
  origin: "https://docs.roost.example.com",
  script: "/assets/client.js",
  stylesheet: "/assets/docs.css",
};

function page(markdown: string, slug = "index"): Document {
  return { slug, markdown, title: "Roost docs", description: "A user's guide" };
}

test("Markdown links resolve to static routes and repeated headings get unique anchors", () => {
  const introduction = page(
    "# Roost\n\n[Install](./install.md#setup) · [Source](../src/router.tsx)\n\n## Setup\n\nFirst\n\n## Setup\n\nSecond",
  );
  const html = renderPage(
    introduction,
    [introduction, page("# Install\n\n## Setup", "install")],
    options,
  );
  assert.match(html, /href="\/install\/#setup"/);
  assert.match(
    html,
    /href="https:\/\/github.com\/srctl\/roost\/blob\/main\/src\/router.tsx"/,
  );
  assert.match(html, /<h2 id="setup">/);
  assert.match(html, /<h2 id="setup-1">/);
  assert.match(html, /href="#setup-1"/);
});

test("pipe tables render semantically and fenced examples remain code", () => {
  const document = page(
    [
      "# Schedules",
      "",
      "| Expression | Schedule |",
      "| --- | --- |",
      "| `0 9 * * *` | **Daily** |",
      "",
      "````markdown",
      "~~~",
      "| Example | Only |",
      "| --- | --- |",
      "| Keep | Code |",
      "~~~",
      "````",
    ].join("\n"),
  );
  const html = renderPage(document, [document], options);
  assert.equal(html.match(/<table>/g)?.length, 1);
  assert.match(html, /<th><span>Expression<\/span><\/th>/);
  assert.match(html, /<td><span><code>0 9 \* \* \*<\/code><\/span><\/td>/);
  assert.match(html, /<strong>Daily<\/strong>/);
  assert.match(
    html,
    /<pre><code class="language-markdown">~~~\n\| Example \| Only \|/,
  );
});

test("static pages escape Markdown HTML, expose metadata, and provide a useful 404", () => {
  const document = {
    ...page(
      '# Welcome\n\n<script>alert("unsafe")</script>\n\n[Unsafe](javascript:alert%281%29)',
    ),
    title: 'Roost <guide> & "reference"',
  };
  const html = renderPage(document, [document], options);
  assert.match(
    html,
    /<title>Roost &lt;guide&gt; &amp; &quot;reference&quot; — Roost docs<\/title>/,
  );
  assert.match(
    html,
    /rel="canonical" href="https:\/\/docs.roost.example.com\/"/,
  );
  assert.doesNotMatch(html, /<script>alert|href="javascript:/);
  const missing = renderPage(undefined, [document], options);
  assert.match(missing, /<h1>Page not found<\/h1>/);
  assert.match(missing, /name="robots" content="noindex"/);
  assert.doesNotMatch(missing, /rel="canonical"/);
});
