// biome-ignore-all lint/suspicious/noArrayIndexKey: These tables render once to static HTML; there is no client reconciliation.
// biome-ignore-all lint/security/noDangerouslySetInnerHtml: Insert only HTML rendered and escaped by ReactMarkdown and React on the server.
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import React, { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown, { type Components } from "react-markdown";
import { docsUrl, markdownUrl } from "./agent-docs.ts";

const repositoryUrl = "https://github.com/srctl/roost";

const groups = [
  {
    title: "Start here",
    pages: [
      ["index", "Introduction"],
      ["getting-started", "Getting started"],
      ["install", "Installation"],
      ["for-agents", "Documentation for agents"],
    ],
  },
  {
    title: "Deployment",
    pages: [
      ["deployment", "Choose a host"],
      ["deploy-exe-dev", "exe.dev"],
      ["deploy-railway", "Railway"],
      ["authentication", "Passkey login"],
      ["deploy-linux", "Linux"],
    ],
  },
  {
    title: "Use Roost",
    pages: [
      ["agents-and-memory", "Agents & memory"],
      ["automations", "Automations"],
      ["delegation", "Delegation"],
      ["files-and-approvals", "Files & approvals"],
      ["computer", "Shared computer"],
      ["dashboards", "Dashboards"],
      ["notifications", "Notifications"],
      ["mobile", "Mobile & home screen"],
    ],
  },
  {
    title: "Build & operate",
    pages: [
      ["development", "Development"],
      ["architecture", "Architecture"],
      ["public-sites", "Public websites"],
      ["remote-desktop-setup", "Desktop setup"],
      ["chat-performance", "Conversation performance"],
      ["pwa-startup", "PWA startup"],
    ],
  },
];

export interface Document {
  slug: string;
  title: string;
  description: string;
  markdown: string;
}

interface Heading {
  id: string;
  title: string;
  level: number;
}

interface PageOptions {
  websiteUrl: string;
  origin?: string;
  script: string;
  stylesheet: string;
  development?: boolean;
}

function plainText(markdown: string) {
  return markdown
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#*`_>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function loadDocuments(directory: string): Document[] {
  return readdirSync(directory)
    .filter((file) => file.endsWith(".md"))
    .sort()
    .map((file) => {
      const markdown = readFileSync(resolve(directory, file), "utf8");
      const title = markdown.match(/^# (.+)$/m)?.[1] || file.slice(0, -3);
      const firstParagraph = markdown
        .replace(/^# .+\n+/, "")
        .split(/\n\s*\n/)[0];
      return {
        slug: file.slice(0, -3),
        title,
        markdown,
        description: plainText(firstParagraph || title).slice(0, 180),
      };
    });
}

function pageUrl(slug: string) {
  return slug === "index" ? "/" : `/${slug}/`;
}

export function searchIndex(documents: Document[]) {
  return documents.map((document) => ({
    title: document.title,
    url: pageUrl(document.slug),
    description: document.description,
    text: plainText(document.markdown),
  }));
}

function nodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return nodeText(node.props.children);
  }
  return "";
}

function documentLink(href: string | undefined, documents: Document[]) {
  if (!href || /^(?:[a-z]+:|\/\/|#)/i.test(href)) return href;
  const target = new URL(href, "https://docs.invalid/docs/");
  const slug = target.pathname.match(/^\/docs\/([^/]+)\.md$/)?.[1];
  if (slug && documents.some((document) => document.slug === slug)) {
    return `${pageUrl(slug)}${target.search}${target.hash}`;
  }
  return `${repositoryUrl}/blob/main${target.pathname}${target.hash}`;
}

function Navigation({
  documents,
  current,
}: {
  documents: Document[];
  current?: string;
}) {
  return (
    <nav aria-label="Documentation">
      {groups.map((group) => (
        <div className="nav-group" key={group.title}>
          <p className="nav-label">{group.title}</p>
          {group.pages.map(([slug, label]) =>
            slug && documents.some((document) => document.slug === slug) ? (
              <a
                key={slug}
                href={pageUrl(slug)}
                aria-current={slug === current ? "page" : undefined}
              >
                {label}
              </a>
            ) : null,
          )}
        </div>
      ))}
    </nav>
  );
}

// Existing docs use simple pipe tables. Keep their inline Markdown and semantic
// table structure without adding a browser runtime or a second content source.
function MarkdownBody({
  source,
  components,
}: {
  source: string;
  components: Components;
}) {
  const lines = source.split("\n");
  const blocks: ReactNode[] = [];
  let buffer: string[] = [];
  let fence = "";
  const flush = () => {
    if (!buffer.length) return;
    blocks.push(
      <Markdown key={`text-${blocks.length}`} components={components}>
        {buffer.join("\n")}
      </Markdown>,
    );
    buffer = [];
  };
  const cells = (line: string) =>
    line
      .trim()
      .replace(/^\||\|$/g, "")
      .split(/(?<!\\)\|/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] || "";
    const marker = line.match(/^\s*(`{3,}|~{3,})/)?.[1];
    if (marker && !fence) fence = marker;
    else if (
      marker &&
      marker[0] === fence[0] &&
      marker.length >= fence.length &&
      line.trim() === marker
    )
      fence = "";
    const divider = lines[index + 1];
    const isTable =
      !fence &&
      line.includes("|") &&
      divider?.includes("|") &&
      cells(divider).every((cell) => /^\s*:?-{3,}:?\s*$/.test(cell));
    if (!isTable) {
      buffer.push(line);
      continue;
    }
    flush();
    const headings = cells(line);
    const rows: string[][] = [];
    index += 2;
    while (index < lines.length && lines[index]?.includes("|")) {
      rows.push(cells(lines[index] || ""));
      index++;
    }
    index--;
    const inline = (text: string) => (
      <Markdown components={{ ...components, p: "span" }}>
        {text.trim()}
      </Markdown>
    );
    blocks.push(
      <div className="table-scroll" key={`table-${blocks.length}`}>
        <table>
          <thead>
            <tr>
              {headings.map((heading, cell) => (
                <th key={`${cell}-${heading}`}>{inline(heading)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={`${rowIndex}-${row.join()}`}>
                {row.map((cell, cellIndex) => (
                  <td key={`${cellIndex}-${cell}`}>{inline(cell)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>,
    );
  }
  flush();
  return blocks;
}

export function renderPage(
  document: Document | undefined,
  documents: Document[],
  options: PageOptions,
) {
  const headings: Heading[] = [];
  const usedIds = new Map<string, number>();
  const heading = (level: number) => {
    return function HeadingElement({ children }: { children?: ReactNode }) {
      const title = nodeText(children);
      const slug = title
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s-]/gu, "")
        .trim()
        .replace(/\s+/g, "-");
      const count = usedIds.get(slug) || 0;
      usedIds.set(slug, count + 1);
      const id = count ? `${slug}-${count}` : slug;
      if (level === 2 || level === 3) headings.push({ id, title, level });
      return React.createElement(
        `h${level}`,
        { id },
        children,
        <a
          className="heading-link"
          href={`#${id}`}
          aria-label={`Link to ${title}`}
        >
          #
        </a>,
      );
    };
  };
  const components: Components = {
    h1: heading(1),
    h2: heading(2),
    h3: heading(3),
    h4: heading(4),
    a: ({ href, children }) => (
      <a href={documentLink(href, documents)}>{children}</a>
    ),
  };
  const content = document
    ? renderToStaticMarkup(
        <MarkdownBody source={document.markdown} components={components} />,
      )
    : '<h1>Page not found</h1><p>This page may have moved. Find a guide in the navigation, or <a href="/">return to the introduction</a>.</p>';
  const title = document?.title || "Page not found";
  const description = document?.description || "Roost documentation.";
  const currentGroup = groups.find((group) =>
    group.pages.some(([slug]) => slug === document?.slug),
  );
  const orderedSlugs = groups.flatMap((group) =>
    group.pages
      .map(([slug]) => slug)
      .filter((slug) => documents.some((page) => page.slug === slug)),
  );
  const nextSlug = document
    ? orderedSlugs[orderedSlugs.indexOf(document.slug) + 1]
    : undefined;
  const next = documents.find((page) => page.slug === nextSlug);
  const canonical =
    options.origin && document
      ? new URL(pageUrl(document.slug), options.origin).href
      : undefined;

  return `<!doctype html>${renderToStaticMarkup(
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#f8f9f5" />
        <meta name="description" content={description} />
        <meta property="og:title" content={`${title} — Roost docs`} />
        <meta property="og:description" content={description} />
        <meta property="og:type" content="website" />
        {!document && <meta name="robots" content="noindex" />}
        {canonical && <link rel="canonical" href={canonical} />}
        {canonical && <meta property="og:url" content={canonical} />}
        <link rel="describedby" href={docsUrl("/llms.txt", options.origin)} />
        {document && (
          <link
            rel="alternate"
            type="text/markdown"
            href={markdownUrl(document.slug, options.origin)}
            title={`${title} (Markdown)`}
          />
        )}
        <title>{`${title} — Roost docs`}</title>
        <link rel="icon" type="image/svg+xml" href="/roost.svg" />
        <link rel="stylesheet" href={options.stylesheet} />
      </head>
      <body>
        <a className="skip-link" href="#content">
          Skip to content
        </a>
        <header className="site-header">
          <a
            className="brand"
            href={options.websiteUrl}
            aria-label="Roost home"
          >
            <img src="/roost.svg" width="32" height="32" alt="" />
            <span>roost</span>
          </a>
          <a className="docs-label" href="/">
            Docs
          </a>
          <div className="header-actions">
            <button className="search-trigger" type="button" data-search-open>
              <span aria-hidden="true">⌕</span> Search docs <kbd>/</kbd>
            </button>
            <a className="github-link" href={repositoryUrl}>
              GitHub ↗
            </a>
            <button
              className="menu-toggle"
              type="button"
              aria-expanded="false"
              aria-controls="sidebar"
              data-menu-toggle
            >
              Menu
            </button>
          </div>
        </header>
        <div className="docs-layout">
          <aside className="sidebar" id="sidebar">
            <Navigation documents={documents} current={document?.slug} />
            <a className="sidebar-home" href={options.websiteUrl}>
              About Roost ↗
            </a>
          </aside>
          <main id="content" className="document" tabIndex={-1}>
            <p className="eyebrow">{currentGroup?.title || "Documentation"}</p>
            <article
              className="prose"
              dangerouslySetInnerHTML={{ __html: content }}
            />
            {document && (
              <footer className="document-footer">
                <div className="document-links">
                  <a
                    href={`${repositoryUrl}/blob/main/docs/${document.slug}.md`}
                  >
                    View on GitHub ↗
                  </a>
                  <a href={markdownUrl(document.slug, options.origin)}>
                    Markdown
                  </a>
                  <a href={docsUrl("/llms.txt", options.origin)}>LLM docs</a>
                </div>
                {next && (
                  <a className="next-page" href={pageUrl(next.slug)}>
                    <span>Next guide</span>
                    {next.title} <span aria-hidden="true">→</span>
                  </a>
                )}
              </footer>
            )}
          </main>
          <aside className="page-outline">
            {headings.length > 0 && (
              <nav aria-label="On this page">
                <p className="nav-label">On this page</p>
                {headings.map((item) => (
                  <a
                    key={item.id}
                    className={item.level === 3 ? "subheading" : undefined}
                    href={`#${item.id}`}
                  >
                    {item.title}
                  </a>
                ))}
              </nav>
            )}
          </aside>
        </div>
        <dialog className="search-dialog" aria-labelledby="search-title">
          <div className="search-heading">
            <label id="search-title" htmlFor="docs-search">
              Search the docs
            </label>
            <button type="button" data-search-close aria-label="Close search">
              Esc
            </button>
          </div>
          <input
            id="docs-search"
            type="search"
            placeholder="Agents, schedules, installation…"
            autoComplete="off"
          />
          <p className="search-status" role="status" aria-live="polite" />
          <div className="search-results" />
        </dialog>
        {options.development && <script type="module" src="/@vite/client" />}
        <script type="module" src={options.script} />
      </body>
    </html>,
  )}`;
}
