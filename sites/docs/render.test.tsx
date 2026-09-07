import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { agentResources, renderMarkdown } from "./src/agent-docs.ts";
import { type Document, loadDocuments, renderPage } from "./src/render";

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
  assert.match(
    html,
    /rel="alternate" type="text\/markdown" href="https:\/\/docs.roost.example.com\/index.md"/,
  );
  assert.match(
    html,
    /rel="describedby" href="https:\/\/docs.roost.example.com\/llms.txt"/,
  );
  assert.doesNotMatch(html, /<script>alert|href="javascript:/);
  const missing = renderPage(undefined, [document], options);
  assert.match(missing, /<h1>Page not found<\/h1>/);
  assert.match(missing, /name="robots" content="noindex"/);
  assert.doesNotMatch(missing, /rel="canonical"/);
});

test("agent resources cover every guide and prioritize deployment before optional technical docs", () => {
  const documents = [
    page("# Architecture\n\nInternals.", "architecture"),
    page("# Deployment\n\nChoose a host.", "deployment"),
    page("# Welcome\n\nIntroduction.", "index"),
    page("# New guide\n\nNewly added content.", "new-guide"),
  ];
  const resources = agentResources(documents, options.origin);
  assert.deepEqual([...resources.keys()].sort(), [
    "architecture.md",
    "deployment.md",
    "index.md",
    "llms-full.txt",
    "llms.txt",
    "new-guide.md",
  ]);
  const index = resources.get("llms.txt") || "";
  assert.match(index, /^# Roost\n\n> /);
  assert.ok(index.indexOf("## Start here") < index.indexOf("## Deployment"));
  assert.ok(index.indexOf("## Deployment") < index.indexOf("## Optional"));
  assert.match(index, /one trusted user/);
  const full = resources.get("llms-full.txt") || "";
  for (const document of documents) {
    const url = `https://docs.roost.example.com/${document.slug}.md`;
    assert.ok(index.includes(url));
    assert.ok(full.includes(`Source: [${document.slug}.md](${url})`));
    assert.ok(full.includes(document.markdown.split("\n\n")[1] || ""));
  }
  assert.deepEqual(
    [...resources],
    [...agentResources([...documents].reverse(), options.origin)],
  );
});

test("raw Markdown rewrites article, anchor, reference, and repository links while preserving code examples", () => {
  const document = page(
    [
      "# Welcome",
      "",
      "[Install](./install.md#setup) [On this page](#welcome) [Source](../src/router.tsx)",
      "",
      "[Reference][setup] [![Status](https://example.com/status.svg)](install.md)",
      "",
      '[setup]: <./install.md#setup> "Installation guide"',
      "",
      "```markdown",
      "[Example](./install.md)",
      "```",
      "",
      "Inline `[Example](./install.md)` is code too.",
    ].join("\n"),
  );
  const documents = [document, page("# Install\n\n## Setup", "install")];
  const raw = renderMarkdown(document, documents);
  assert.match(raw, /\[Install\]\(\/install.md#setup\)/);
  assert.match(raw, /\[On this page\]\(\/index.md#welcome\)/);
  assert.match(
    raw,
    /\[Source\]\(https:\/\/github.com\/srctl\/roost\/blob\/main\/src\/router.tsx\)/,
  );
  assert.match(raw, /\[setup\]: <\/install.md#setup> "Installation guide"/);
  assert.match(
    raw,
    /\[!\[Status\]\(https:\/\/example.com\/status.svg\)\]\(\/install.md\)/,
  );
  assert.match(raw, /```markdown\n\[Example\]\(\.\/install.md\)\n```/);
  assert.match(raw, /`\[Example\]\(\.\/install.md\)`/);
  assert.doesNotMatch(raw, /localhost|docs.invalid/);
  const absolute = renderMarkdown(document, documents, options.origin);
  assert.match(
    absolute,
    /\[Install\]\(https:\/\/docs.roost.example.com\/install.md#setup\)/,
  );
  assert.match(
    absolute,
    /\[On this page\]\(https:\/\/docs.roost.example.com\/index.md#welcome\)/,
  );
});

test("loading agent resources reflects added, changed, and removed source docs without a restart", () => {
  const directory = mkdtempSync(join(tmpdir(), "roost-agent-docs-"));
  try {
    writeFileSync(
      join(directory, "index.md"),
      "# Welcome\n\nOriginal overview.",
    );
    const first = agentResources(loadDocuments(directory));
    assert.match(first.get("llms.txt") || "", /Original overview/);
    writeFileSync(
      join(directory, "index.md"),
      "# Welcome\n\nUpdated overview.",
    );
    writeFileSync(
      join(directory, "deploy-linux.md"),
      "# Linux\n\nA new deployment guide.",
    );
    const updated = agentResources(loadDocuments(directory));
    assert.match(updated.get("llms.txt") || "", /Updated overview/);
    assert.match(updated.get("llms-full.txt") || "", /A new deployment guide/);
    assert.ok(updated.has("deploy-linux.md"));
    rmSync(join(directory, "deploy-linux.md"));
    const removed = agentResources(loadDocuments(directory));
    assert.ok(!removed.has("deploy-linux.md"));
    assert.doesNotMatch(removed.get("llms.txt") || "", /deploy-linux.md/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
