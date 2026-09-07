# Host the public websites

Roost has two independent static websites: a marketing page and a documentation
site. Deploy each output to its own domain on any static web host. Neither site
needs the Roost server, a database, Codex credentials, or access to agent data.

## Build each site

Run commands from the repository root. Use Node.js 22.13+ and pnpm 9.15.0. In a
fresh checkout, first run `corepack pnpm install --frozen-lockfile`.

| Site | Build command | Publish directory |
| --- | --- | --- |
| Marketing | `corepack pnpm build:marketing` | `sites/marketing/dist` |
| Documentation | `corepack pnpm build:docs` | `sites/docs/dist` |

For a hosting provider connected to this Git repository, keep the project/root
directory set to the **repository root**, select a static site or no-framework
preset, and use the appropriate build command and publish directory above.
Create two hosting projects pointing at this repository to deploy independently.

To build both locally:

```sh
corepack pnpm build:sites
```

The websites reuse the repository's installed build tools, but have separate
Vite configurations, assets, and output folders. The app's `pnpm build` and
release archive do not include either website. `pnpm check` validates the app
and both public sites.

## Set the public addresses

Set these build-time environment variables on **both** hosting projects, using
your actual domains:

```sh
ROOST_WEBSITE_URL=https://roost.example.com
ROOST_DOCS_URL=https://docs.roost.example.com
```

They connect the sites' navigation and set canonical page addresses. Use origin
URLs without a path; each site is intended to live at the root of its own domain.
No app URL is needed. Rebuild when an address changes.

For local overrides, copy each site's `.env.example` to `.env` in the same
directory and replace the examples. Environment variables configured by your
hosting provider take precedence over these files.

Without configured public addresses, production builds link to the repository
and its Markdown documentation on GitHub, and omit canonical tags. Development
uses the other site's local address. Set both public URLs before publishing to
connect the deployed sites directly.

## Preview locally

Run these in separate terminals:

```sh
corepack pnpm dev:marketing # http://127.0.0.1:4173
corepack pnpm dev:docs      # http://127.0.0.1:4174
```

Both servers listen on loopback. Documentation edits reload the docs preview.
After a build, use `pnpm preview:marketing` and `pnpm preview:docs` to inspect the
production outputs on the same ports; stop the development servers first.

## Static hosting behavior

Publish **only** the matching `dist` directory. The marketing page is a single
HTML document. Docs have a pre-rendered `index.html` for each guide, so readers
can open `/getting-started/` or `/automations/` directly. Article content and
navigation work without JavaScript; search, mobile menu toggling, and code
copying use a small browser script.

Enable your host's directory-index behavior and use `404.html` as the docs error
page. Do not add a single-page-app fallback that sends every URL to the home
page. Serve HTML and `search-index.json` with revalidation; only fingerprinted
files under `assets` should receive long-lived immutable caching. The docs
stylesheet is not fingerprinted and should revalidate too.

The marketing site loads DM Sans from Google Fonts, with local system fonts as
a fallback. Its logo and character artwork are local assets. The docs use system
fonts and make no external font requests.

See [Vite's static deployment guide](https://vite.dev/guide/static-deploy) for
provider-specific setup. Publishing these sites does not publish the Roost app;
keep the app's HTTP and WebSocket access private as described in
[Installation](install.md).

## Maintain the content

- Edit the marketing page in `sites/marketing/index.html`, its styles in
  `sites/marketing/style.css`, and its small motion script in
  `sites/marketing/main.ts`.
- Edit docs in the root `docs/` directory. The site reads those Markdown files
  during development and at build time; there is no duplicate content tree.
- For a new guide, add its slug and navigation label to the groups in
  `sites/docs/src/render.tsx`, and link it from [the introduction](index.md).
  Relative Markdown links to existing guides become links to public HTML pages.
  Links to repository files remain GitHub links.
- Change the docs layout and typography in `sites/docs/src/style.css`.

Run `corepack pnpm check:sites` to check site types, renderer regressions, and
both production builds. Run `corepack pnpm lint` to check formatting and lint
rules across the repo.
