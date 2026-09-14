import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import type { Document } from "./render.tsx";

const repositoryUrl = "https://github.com/srctl/roost";
const overview =
  "Roost is a self-hosted home for persistent Codex agents, conversations, memory, and scheduled work.";
const boundaries =
  "Roost is designed for one trusted user. Keep the app private behind access controls. The host must stay running for agents and schedules to execute; the public marketing and documentation sites can be hosted separately.";
const sections = [
  {
    title: "Start here",
    slugs: ["index", "getting-started", "install", "for-agents"],
  },
  {
    title: "Deployment",
    slugs: [
      "deployment",
      "deploy-exe-dev",
      "deploy-railway",
      "authentication",
      "deploy-linux",
    ],
  },
  {
    title: "Use Roost",
    slugs: [
      "agents-and-memory",
      "coding-agents",
      "automations",
      "delegation",
      "files-and-approvals",
      "computer",
      "dashboards",
      "notifications",
      "mobile",
    ],
  },
];

export function docsUrl(path: string, origin?: string) {
  return origin ? new URL(path, origin).href : path;
}

export function markdownUrl(slug: string, origin?: string) {
  return docsUrl(`/${slug}.md`, origin);
}

interface MarkdownNode {
  type: string;
  url?: string;
  children?: MarkdownNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}

function markdownLink(
  href: string,
  document: Document,
  documents: Document[],
  origin?: string,
) {
  if (!href || /^(?:[a-z][\w+.-]*:|\/\/)/i.test(href)) return href;
  const target = new URL(href, `https://docs.invalid/docs/${document.slug}.md`);
  const slug = target.pathname.match(/^\/(?:docs\/)?([^/]+)\.md$/)?.[1];
  if (slug && documents.some((page) => page.slug === slug)) {
    return `${markdownUrl(slug, origin)}${target.search}${target.hash}`;
  }
  if (target.pathname === "/llms.txt" || target.pathname === "/llms-full.txt") {
    return docsUrl(`${target.pathname}${target.search}${target.hash}`, origin);
  }
  return `${repositoryUrl}/blob/main${target.pathname}${target.search}${target.hash}`;
}

// CommonMark identifies the links, so code examples and reference labels stay
// untouched. Only replace each parsed link's destination in the original text.
export function renderMarkdown(
  document: Document,
  documents: Document[],
  origin?: string,
) {
  const edits: { start: number; end: number; value: string }[] = [];
  function rewriteLinks() {
    return (tree: MarkdownNode) => {
      function visit(node: MarkdownNode) {
        node.children?.forEach(visit);
        if (!node.url || !node.position) return;
        const url = markdownLink(node.url, document, documents, origin);
        const start = node.position.start.offset;
        const end = node.position.end.offset;
        if (url === node.url || start === undefined || end === undefined)
          return;
        const source = document.markdown.slice(start, end);
        const marker = node.type === "definition" ? "]:" : "](";
        let from = source.lastIndexOf(marker) + marker.length;
        while (/\s/.test(source[from] || "")) from++;
        const angle = source[from] === "<";
        if (angle) from++;
        let to = from;
        let parentheses = 0;
        for (; to < source.length; to++) {
          const char = source[to];
          if (char === "\\") {
            to++;
            continue;
          }
          if (angle && char === ">") break;
          if (
            !angle &&
            (/\s/.test(char || "") || (char === ")" && !parentheses))
          )
            break;
          if (char === "(") parentheses++;
          if (char === ")") parentheses--;
        }
        edits.push({ start: start + from, end: start + to, value: url });
      }
      visit(tree);
    };
  }
  renderToStaticMarkup(
    createElement(
      Markdown,
      { remarkPlugins: [rewriteLinks] },
      document.markdown,
    ),
  );
  let markdown = document.markdown;
  for (const edit of edits.sort((left, right) => right.start - left.start)) {
    markdown = `${markdown.slice(0, edit.start)}${edit.value}${markdown.slice(edit.end)}`;
  }
  return markdown;
}

export function agentResources(documents: Document[], origin?: string) {
  const ordered = sections.map((section) => ({
    title: section.title,
    documents: section.slugs.flatMap((slug) =>
      documents.filter((document) => document.slug === slug),
    ),
  }));
  const featured = new Set(ordered.flatMap((section) => section.documents));
  ordered.push({
    title: "Optional",
    documents: documents
      .filter((document) => !featured.has(document))
      .sort((left, right) => left.slug.localeCompare(right.slug)),
  });
  const pages = ordered.flatMap((section) => section.documents);
  const resources = new Map<string, string>();
  for (const document of pages) {
    resources.set(
      `${document.slug}.md`,
      renderMarkdown(document, documents, origin),
    );
  }
  const index = [
    "# Roost",
    `> ${overview}`,
    boundaries,
    `For every guide in a single file, read [the complete documentation](${docsUrl("/llms-full.txt", origin)}).`,
    ...ordered
      .filter((section) => section.documents.length)
      .map((section) =>
        [
          `## ${section.title}`,
          section.documents
            .map(
              (document) =>
                `- [${document.title}](${markdownUrl(document.slug, origin)}): ${document.description}`,
            )
            .join("\n"),
        ].join("\n\n"),
      ),
  ].join("\n\n");
  resources.set("llms.txt", `${index}\n`);
  resources.set(
    "llms-full.txt",
    [
      "# Roost complete documentation",
      `> ${overview}`,
      boundaries,
      `Documentation index: [llms.txt](${docsUrl("/llms.txt", origin)}).`,
      ...pages.map((document) =>
        [
          "---",
          `# ${document.title}`,
          `Source: [${document.slug}.md](${markdownUrl(document.slug, origin)})`,
          resources
            .get(`${document.slug}.md`)
            ?.replace(/^# .+\r?\n/, "")
            .trim(),
        ].join("\n\n"),
      ),
      "",
    ].join("\n\n"),
  );
  return resources;
}

export function agentContentType(path: string) {
  return path.endsWith(".md")
    ? "text/markdown; charset=utf-8"
    : "text/plain; charset=utf-8";
}
