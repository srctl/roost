# Public websites on Vercel

Use Vercel for Roost's marketing and documentation websites. Create two Vercel
projects connected to the same Git repository, with separate build settings and
domains. Both outputs are static files and need no Codex login, agent data, or
Roost server.

The settings below were checked against Vercel's documentation in September 2026.

## Create the projects

Import `srctl/roost` into Vercel twice, using distinct project names such as
`roost-website` and `roost-docs`. For **both** projects:

- Keep **Root Directory** at the repository root. The site folders reuse the
  root package manifest and lockfile; they are not standalone packages.
- Set **Framework Preset** to **Other** so Vercel does not select the Roost
  application framework.
- Select Node.js **24.x**, which meets Roost's Node.js 22.13+ requirement.
- Override **Install Command** with `corepack pnpm install --frozen-lockfile`.
- Add `ENABLE_EXPERIMENTAL_COREPACK=1` to honor the repository's pinned pnpm
  version.

Set the project-specific build overrides:

| Project | Build Command | Output Directory |
| --- | --- | --- |
| Marketing | `corepack pnpm build:marketing` | `sites/marketing/dist` |
| Documentation | `corepack pnpm build:docs` | `sites/docs/dist` |

Vercel supports project-level build/install overrides and publishes only the
chosen output directory. These settings let both projects share the repository
without a root `vercel.json` forcing them to use the same output. See
[build configuration](https://vercel.com/docs/builds/configure-a-build) and
[supported Node.js versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions).

Do not use the app's `pnpm build` command, `.output` directory, or `pnpm start` for
either static project.

## Connect the public addresses

Add these build-time environment variables to both projects, replacing the
example origins with your domains or their stable Vercel project addresses:

```sh
ROOST_WEBSITE_URL=https://roost.example.com
ROOST_DOCS_URL=https://docs.roost.example.com
```

Use an origin without a subdirectory. The variables connect the two sites and
set canonical URLs. They are public addresses, not secrets. Set them for each
Vercel environment you deploy and rebuild both projects after changing them.
For initial preview verification, project addresses work before custom domains
are connected. See [Public websites](public-sites.md#set-the-public-addresses)
for the repository's fallback behavior.

These are the only Roost-specific variables the sites need. Keep app credentials,
data directory configuration, and desktop access out of these projects.

## Keep the generated page routes

The documentation build emits a real `index.html` for each guide, such as
`getting-started/index.html`. Use Vercel's static file routing. Do not add a
catch-all rewrite to `/index.html`; it would replace direct article requests
with the docs home page.

The docs output also includes `404.html`. Vercel uses this filename for unmatched
static routes; no server function is needed. See
[Vercel's custom 404 guide](https://vercel.com/kb/guide/custom-404-page).

Keep HTML, `search-index.json`, and the docs stylesheet revalidatable. Reserve
long-lived immutable caching for fingerprinted assets. The default setup does
not require custom caching rules.

## Check the deployments

Before announcing either site as live:

1. Confirm each project's build used its assigned command and output directory.
2. Open the marketing page and all three interactive agent examples on desktop
   and mobile.
3. Open the docs home and `/getting-started/` directly, then reload the article.
   Check search, the mobile menu, and a code block's Copy button.
4. Open a nonexistent docs path and confirm the response is a 404 page, not the
   home page or a successful response with missing content.
5. Follow the links between the two sites and check canonical URLs against the
   configured origins.
6. Fetch `/llms.txt` on both sites, plus `/llms-full.txt` and `/deployment.md` on
   the docs site. Confirm they return text with working public links, without
   an HTML fallback or sign-in challenge.

For an agent-assisted deployment, provide the two intended Vercel project names
and public origins, ask it to use the exact table above, and request the verified
deployment URLs and check results. Publishing the websites does not publish the
private Roost application.

## Why the Roost app needs another host

The current app keeps a local SQLite database, writable workspaces, persistent
Codex homes, and a long-running background worker. It also starts Codex
subprocesses and can host a desktop WebSocket connection.

Ordinary Vercel Functions have a read-only filesystem with temporary scratch
space and bounded request execution. Those properties do not provide Roost's
durable filesystem and continuous worker. Adding a Vercel cron job or changing a
function timeout does not supply them. See
[Vercel runtimes](https://vercel.com/docs/functions/runtimes) and
[function limits](https://vercel.com/docs/functions/limitations).

Vercel's Container Images beta also runs as Functions. Its documented scale-in
behavior terminates idle production instances after five minutes without traffic,
so adding a Dockerfile does not provide an always-running Roost worker. See
[Container Images](https://vercel.com/docs/functions/container-images#scale-in-behavior).

Vercel's separate workflow and sandbox products do not turn this unchanged app
into a compatible deployment; adopting them would require a different execution
and storage architecture. Use [a persistent host](deployment.md) for the app and
Vercel for the public sites.
